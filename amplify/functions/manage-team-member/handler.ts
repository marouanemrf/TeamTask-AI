import { randomUUID } from 'node:crypto';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminRemoveUserFromGroupCommand, CognitoIdentityProviderClient, CreateGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { env } from '$amplify/env/manage-team-member';
import type { Schema } from '../../data/resource';
import { writeEvent } from '../shared/audit';
import type { Caller } from '../shared/auth';
import { createDataClient, check } from '../shared/data';
import { fail } from '../shared/errors';
import { runMutation } from '../shared/handler';
import { assertSameOrganisation, managersGroupOf, organisationGroupsFor, requireOrganisation } from '../shared/tenancy';
import { normalizeEmail, normalizeUsername } from '../shared/text';
import * as v from '../shared/validate';

/**
 * Accounts, teams and organisations — administrators only (use case "Manage accounts, teams").
 * Everything happens in the caller's organisation (from the token); a record of another
 * organisation is reported as not found. Each account is kept in its organisation's Cognito groups
 * (see shared/tenancy.ts), which isolate the organisation's data in the data API.
 */

const db = await createDataClient(env);
const cognito = new CognitoIdentityProviderClient({});
const pool = process.env.USER_POOL_ID!;
const VALID = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const;

type MemberArgs = Schema['manageTeamMember']['args'];
type TeamArgs = Schema['manageTeam']['args'];

/** Team (same organisation) and planned absence; undefined = unchanged. */
async function extraFields(input: { teamId?: string | null; unavailableFrom?: string | null; unavailableUntil?: string | null }, organisationId: string) {
  const out: { teamId?: string | null; unavailableFrom?: string | null; unavailableUntil?: string | null } = {};
  if (input.teamId !== undefined) {
    if (input.teamId) {
      const team = check(await db.models.Team.get({ id: input.teamId }), 'Team.get');
      if (!team || team.organisationId !== organisationId) fail('VALIDATION', 'This team is not part of the organisation.');
    }
    out.teamId = input.teamId || null;
  }
  if (input.unavailableFrom !== undefined) out.unavailableFrom = v.optionalDate(input.unavailableFrom, 'Absence start');
  if (input.unavailableUntil !== undefined) out.unavailableUntil = v.optionalDate(input.unavailableUntil, 'Absence end');
  if (out.unavailableFrom && out.unavailableUntil && out.unavailableUntil < out.unavailableFrom) fail('VALIDATION', 'The end of the absence must be on or after its start.');
  return out;
}

async function ensureGroup(name: string, description: string) {
  try {
    await cognito.send(new CreateGroupCommand({ UserPoolId: pool, GroupName: name, Description: description }));
  } catch (error) {
    if (!(error instanceof Error && error.name === 'GroupExistsException')) throw error;
  }
}

/** Puts the account in its organisation groups (all members; managers group only for ADMIN / PROJECT_MANAGER). */
async function syncOrganisationGroups(email: string, organisationId: string, roles: readonly string[]) {
  const wanted = organisationGroupsFor(organisationId, roles);
  for (const group of wanted) {
    await ensureGroup(group, group === organisationId ? 'TeamTask organisation: members (data isolation)' : 'TeamTask organisation: managers (data isolation)');
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: email, GroupName: group }));
  }
  if (!wanted.includes(managersGroupOf(organisationId))) {
    await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: email, GroupName: managersGroupOf(organisationId) })).catch(() => undefined);
  }
}

const audit = (organisationId: string, caller: Caller, entityId: string, eventType: 'CREATED' | 'UPDATED' | 'STATUS_CHANGED', before?: unknown, after?: unknown) =>
  writeEvent(db, { organisationId, entityId, eventType, actorEmail: caller.email, before, after, requestId: randomUUID() });

const memberSnapshot = (m: Schema['TeamMember']['type']) => ({ name: m.name, email: m.email, roles: m.roles, jobTitle: m.jobTitle, teamId: m.teamId, weeklyCapacityHours: m.weeklyCapacityHours });

/** First administrator of a new organisation: creates it, its groups and their own profile. */
async function setupOrganisation(caller: Caller, input: MemberArgs) {
  if (caller.organisationId) fail('VALIDATION', 'Your account already belongs to an organisation.');
  const name = v.text(input.name, 'Organisation name', { max: 120 });
  let token: string | null | undefined; do {
    const page = await db.models.TeamMember.list({ nextToken: token, limit: 1000 });
    if (check(page, 'TeamMember.list').some((m) => normalizeEmail(m.email) === caller.email)) fail('VALIDATION', 'Your account already belongs to an organisation. Sign out, then sign in again.');
    token = page.nextToken;
  } while (token);
  const organisation = check(await db.models.Organisation.create({ name }), 'Organisation.create');
  if (!organisation) throw new Error('Organisation.create returned no data');
  await syncOrganisationGroups(caller.email, organisation.id, ['ADMIN']);
  const member = check(await db.models.TeamMember.create({ organisationId: organisation.id, name: caller.email.split('@')[0], email: caller.email, username: normalizeUsername(caller.email.split('@')[0]).replace(/[^a-z0-9._-]/g, '').slice(0, 26) || 'admin', role: 'ADMIN', roles: ['ADMIN'], skills: [], weeklyCapacityHours: 40 }), 'TeamMember.create');
  if (!member) throw new Error('TeamMember.create returned no data');
  await audit(organisation.id, caller, organisation.id, 'CREATED', undefined, { name });
  return member;
}

async function createMember(caller: Caller, organisationId: string, input: MemberArgs, fields: { name: string; email: string; username: string; roles: string[]; capacity: number }) {
  const { name, email, username, roles, capacity } = fields;
  let token: string | null | undefined; do {
    const page = await db.models.TeamMember.list({ nextToken: token, limit: 1000 });
    const existing = check(page, 'TeamMember.list');
    if (existing.some((m) => normalizeEmail(m.email) === email || (m.organisationId === organisationId && m.username && normalizeUsername(m.username) === username))) fail('VALIDATION', 'An account already exists with this email or username.');
    token = page.nextToken;
  } while (token);
  let accountCreated = false;
  try {
    await cognito.send(new AdminCreateUserCommand({ UserPoolId: pool, Username: email, DesiredDeliveryMediums: ['EMAIL'], UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: name }] }));
    accountCreated = true;
    for (const role of roles) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: email, GroupName: role }));
    await syncOrganisationGroups(email, organisationId, roles);
    const extra = await extraFields(input, organisationId);
    const row = check(await db.models.TeamMember.create({ organisationId, name, email, username, role: roles[0] as typeof VALID[number], roles, jobTitle: input.jobTitle?.trim() || undefined, skills: input.skills ?? [], weeklyCapacityHours: capacity, avatarKey: input.avatarKey, ...extra }), 'TeamMember.create');
    if (!row) throw new Error('Member profile was not created');
    await audit(organisationId, caller, row.id, 'CREATED', undefined, memberSnapshot(row));
    return row;
  } catch (error) {
    if (accountCreated) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: email })).catch(() => undefined);
    if (error && typeof error === 'object' && 'name' in error && error.name === 'UsernameExistsException') fail('VALIDATION', 'A sign-in account already exists with this email address.');
    throw error;
  }
}

async function updateMember(caller: Caller, organisationId: string, input: MemberArgs, fields: { name: string; email: string; username: string; roles: string[]; capacity: number }) {
  const { name, email, username, roles, capacity } = fields;
  if (!input.memberId) fail('VALIDATION', 'The member id is required.');
  const before = check(await db.models.TeamMember.get({ id: input.memberId }), 'TeamMember.get');
  assertSameOrganisation(before, organisationId, 'This member');
  // Administrators manage their own record too, but can't remove their own ADMIN role (no lock-out).
  if (normalizeEmail(before!.email ?? '') === caller.email && !roles.includes('ADMIN')) fail('VALIDATION', "You can't remove your own Admin role.");
  if (normalizeEmail(before!.email) !== email) fail('VALIDATION', "The email address of an existing account can't be changed.");
  const accountEmail = normalizeEmail(before!.email ?? '');
  const existingRoles = (before!.roles?.length ? before!.roles : [before!.role ?? 'VIEWER']).filter((role): role is string => !!role);
  const extra = await extraFields(input, organisationId);
  try {
    for (const role of existingRoles) if (!roles.includes(role)) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role }));
    for (const role of roles) if (!existingRoles.includes(role)) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role }));
    await syncOrganisationGroups(accountEmail, organisationId, roles);
    const updated = check(await db.models.TeamMember.update({ id: before!.id, name, username, role: roles[0] as typeof VALID[number], roles, jobTitle: input.jobTitle?.trim() || null, skills: input.skills ?? [], weeklyCapacityHours: capacity, avatarKey: input.avatarKey === undefined ? before!.avatarKey : input.avatarKey, ...extra }), 'TeamMember.update');
    if (!updated) fail('NOT_FOUND', 'This member no longer exists.');
    await audit(organisationId, caller, updated.id, 'UPDATED', memberSnapshot(before!), memberSnapshot(updated));
    return updated;
  } catch (error) {
    for (const role of roles) if (!existingRoles.includes(role)) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role })).catch(() => undefined);
    for (const role of existingRoles) if (!roles.includes(role)) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role })).catch(() => undefined);
    await syncOrganisationGroups(accountEmail, organisationId, existingRoles).catch(() => undefined);
    throw error;
  }
}

async function deleteMember(caller: Caller, organisationId: string, memberId: string | null | undefined) {
  if (!memberId) fail('VALIDATION', 'The member id is required.');
  const member = check(await db.models.TeamMember.get({ id: memberId }), 'TeamMember.get');
  assertSameOrganisation(member, organisationId, 'This member');
  if (normalizeEmail(member!.email ?? '') === caller.email) fail('FORBIDDEN', "You can't delete your own account.");
  let token: string | null | undefined; do { const page = await db.models.Task.list({ filter: { assigneeId: { eq: member!.id } }, nextToken: token, limit: 1000 }); if (check(page, 'Task.list').some((t) => !['DONE', 'CANCELLED'].includes(t.status ?? 'TODO'))) fail('VALIDATION', 'Reassign or close the open tasks before deleting this account.'); token = page.nextToken; } while (token);
  const memberEmail = normalizeEmail(member!.email ?? '');
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: memberEmail }));
  try { check(await db.models.TeamMember.delete({ id: member!.id }), 'TeamMember.delete'); await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: memberEmail })); }
  catch (error) { await cognito.send(new AdminEnableUserCommand({ UserPoolId: pool, Username: memberEmail })).catch(() => undefined); throw error; }
  await audit(organisationId, caller, member!.id, 'STATUS_CHANGED', memberSnapshot(member!), { deleted: true });
  return member!;
}

async function manageTeam(caller: Caller, organisationId: string, input: TeamArgs) {
  if (input.action === 'CREATE') {
    const name = v.text(input.name, 'Team name', { max: 120 });
    const description = v.optionalText(input.description, 'Description', 500);
    const leadMemberId = v.optionalId(input.leadMemberId, 'Team lead');
    if (leadMemberId) assertSameOrganisation(check(await db.models.TeamMember.get({ id: leadMemberId }), 'TeamMember.get'), organisationId, 'This team lead');
    const team = check(await db.models.Team.create({ organisationId, name, description, leadMemberId }), 'Team.create');
    if (!team) throw new Error('Team.create returned no data');
    await audit(organisationId, caller, team.id, 'CREATED', undefined, { name, leadMemberId });
    return team;
  }
  if (input.action !== 'DELETE') fail('VALIDATION', 'Unknown team action.');
  const team = check(await db.models.Team.get({ id: v.id(input.teamId, 'Team') }), 'Team.get');
  assertSameOrganisation(team, organisationId, 'This team');
  const members = check(await db.models.TeamMember.list({ filter: { teamId: { eq: team!.id } }, limit: 1000 }), 'TeamMember.list');
  if (members.length) fail('VALIDATION', 'Move the members to another team before deleting this one.');
  check(await db.models.Team.delete({ id: team!.id }), 'Team.delete');
  await audit(organisationId, caller, team!.id, 'STATUS_CHANGED', { name: team!.name }, { deleted: true });
  return team!;
}

// Amplify passes the GraphQL field name at the top level of the event (fieldName, typeName).
export const handler = (event: { arguments: MemberArgs | TeamArgs; identity?: unknown; fieldName?: string; info?: { fieldName?: string } }) => runMutation('manage-team-member', event, async (caller, args) => {
  if (!caller.roles.includes('ADMIN')) fail('FORBIDDEN', 'Only administrators can manage accounts and teams.');
  if ((event.fieldName ?? event.info?.fieldName) === 'manageTeam') return manageTeam(caller, requireOrganisation(caller), args as TeamArgs);
  const input = args as MemberArgs;
  const action = input.action;
  if (action === 'SETUP_ORGANISATION') return setupOrganisation(caller, input);
  if (!['CREATE', 'UPDATE', 'DELETE'].includes(action)) fail('VALIDATION', 'Unknown account action.');
  const organisationId = requireOrganisation(caller);
  if (input.organisationId && input.organisationId !== organisationId) fail('FORBIDDEN', 'You can only manage members of your organisation.');
  if (action === 'DELETE') return deleteMember(caller, organisationId, input.memberId);

  const name = input.name?.trim(); const email = normalizeEmail(input.email ?? ''); const username = normalizeUsername(input.username ?? '');
  const roles = (input.roles?.length ? input.roles : input.role ? [input.role] : ['MEMBER']) as string[];
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/.test(username)) fail('VALIDATION', 'Invalid name, email address or username.');
  if (!roles.length || roles.some((r) => !(VALID as readonly string[]).includes(r)) || new Set(roles).size !== roles.length) fail('VALIDATION', 'Select one or more valid roles.');
  const capacity = input.weeklyCapacityHours ?? 40;
  if ((input.skills ?? []).length > 30 || (input.jobTitle?.length ?? 0) > 200 || (input.avatarKey && !/^(?:avatars\/[A-Za-z0-9._-]+|profile-avatars\/[A-Za-z0-9:_-]+\/[A-Za-z0-9._-]+)$/.test(input.avatarKey))) fail('VALIDATION', 'Invalid job title, photo or number of skills.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 60 || (input.skills ?? []).some((s) => !s?.trim() || s.length > 80)) fail('VALIDATION', 'Invalid capacity or skills.');
  const fields = { name, email, username, roles, capacity };
  return action === 'CREATE' ? createMember(caller, organisationId, input, fields) : updateMember(caller, organisationId, input, fields);
}) as ReturnType<Schema['manageTeamMember']['functionHandler']>;
