import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminRemoveUserFromGroupCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { env } from '$amplify/env/manage-team-member';
import type { Schema } from '../../data/resource';
import { createDataClient, check } from '../shared/data';
import { fail } from '../shared/errors';
import { runMutation } from '../shared/handler';
import { isManagerRole } from '../shared/rules';
import { normalizeEmail, normalizeUsername } from '../shared/text';

const db = await createDataClient(env);
const cognito = new CognitoIdentityProviderClient({});
const pool = process.env.USER_POOL_ID!;
const VALID = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const;

async function ensureOrganisationAccess(organisationId: string, email: string, roles: readonly string[]) {
  const org = check(await db.models.Organisation.get({ id: organisationId }), 'Organisation.get');
  if (!org) fail('NOT_FOUND', "This organisation doesn't exist.");
  let token: string | null | undefined; let actorOrganisation: string | undefined;
  do {
    const page = await db.models.TeamMember.list({ nextToken: token, limit: 1000 });
    const found = check(page, 'TeamMember.list').find((member) => normalizeEmail(member.email ?? '') === email);
    if (found) { actorOrganisation = found.organisationId ?? undefined; break; }
    token = page.nextToken;
  } while (token);
  if (actorOrganisation ? actorOrganisation !== organisationId : !roles.includes('ADMIN')) fail('FORBIDDEN', 'You can only manage members of your organisation.');
}

export const handler: Schema['manageTeamMember']['functionHandler'] = (event) => runMutation('manage-team-member', event, async (caller, input) => {
  if (!isManagerRole(caller.roles)) fail('FORBIDDEN', 'Only managers can manage team accounts.');
  const action = input.action;
  if (!['CREATE', 'UPDATE', 'DELETE'].includes(action)) fail('VALIDATION', 'Action de gestion inconnue.');
  if (action === 'CREATE' || action === 'UPDATE') {
    const name = input.name?.trim(); const email = normalizeEmail(input.email ?? ''); const username = normalizeUsername(input.username ?? '');
    const roles = (input.roles?.length ? input.roles : input.role ? [input.role] : ['MEMBER']) as string[];
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/.test(username)) fail('VALIDATION', 'Nom, adresse e-mail ou identifiant invalide.');
    if (!roles.length || roles.some((r) => !(VALID as readonly string[]).includes(r)) || new Set(roles).size !== roles.length) fail('VALIDATION', 'Select one or more valid roles.');
    if (!caller.roles.includes('ADMIN') && roles.some((r) => r === 'ADMIN' || r === 'PROJECT_MANAGER')) fail('FORBIDDEN', 'Only an administrator can grant the Admin or Project manager roles.');
    const capacity = input.weeklyCapacityHours ?? 40;
    if ((input.skills ?? []).length > 30 || (input.jobTitle?.length ?? 0) > 200 || (input.avatarKey && !/^(?:avatars\/[A-Za-z0-9._-]+|profile-avatars\/[A-Za-z0-9:_-]+\/[A-Za-z0-9._-]+)$/.test(input.avatarKey))) fail('VALIDATION', 'Invalid job title, photo or number of skills.');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 60 || (input.skills ?? []).some((s) => !s?.trim() || s.length > 80)) fail('VALIDATION', 'Invalid capacity or skills.');
    if (action === 'CREATE') {
      if (!input.organisationId) fail('VALIDATION', 'Organisation obligatoire.');
      await ensureOrganisationAccess(input.organisationId, caller.email, caller.roles);
      let token: string | null | undefined; do {
        const page = await db.models.TeamMember.list({ nextToken: token, limit: 1000 });
        const existing = check(page, 'TeamMember.list');
        if (existing.some((m) => normalizeEmail(m.email) === email || (m.username && normalizeUsername(m.username) === username))) fail('VALIDATION', 'An account already exists with this email or username.');
        token = page.nextToken;
      } while (token);
      let accountCreated = false;
      try {
        await cognito.send(new AdminCreateUserCommand({ UserPoolId: pool, Username: email, DesiredDeliveryMediums: ['EMAIL'], UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: name }] }));
        accountCreated = true;
        for (const role of roles) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: email, GroupName: role }));
        const row = check(await db.models.TeamMember.create({ organisationId: input.organisationId, name, email, username, role: roles[0] as typeof VALID[number], roles, jobTitle: input.jobTitle?.trim() || undefined, skills: input.skills ?? [], weeklyCapacityHours: capacity, avatarKey: input.avatarKey }), 'TeamMember.create');
        if (!row) throw new Error('Member profile was not created');
        return row;
      } catch (error) {
        if (accountCreated) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: email })).catch(() => undefined);
        if (error && typeof error === 'object' && 'name' in error && error.name === 'UsernameExistsException') fail('VALIDATION', 'A sign-in account already exists with this email address.');
        throw error;
      }
    }
    if (!input.memberId) fail('VALIDATION', 'The member id is required.');
    const before = check(await db.models.TeamMember.get({ id: input.memberId }), 'TeamMember.get');
    if (!before) fail('NOT_FOUND', 'This member no longer exists.');
    await ensureOrganisationAccess(before.organisationId, caller.email, caller.roles);
    const priorRoles = (before.roles?.length ? before.roles : [before.role ?? 'VIEWER']).filter((role): role is string => !!role);
    if (priorRoles.some((r) => r === 'ADMIN' || r === 'PROJECT_MANAGER') && !caller.roles.includes('ADMIN')) fail('FORBIDDEN', "Only an administrator can edit or delete a manager's account.");
    // Administrators manage their own record too, but can't remove their own ADMIN role (no lock-out).
    // Other managers can't edit their own account here (they use their profile page).
    if (normalizeEmail(before.email ?? '') === caller.email) {
      if (!caller.roles.includes('ADMIN')) fail('FORBIDDEN', "You can't edit your own account here. Use your profile page.");
      if (!roles.includes('ADMIN')) fail('VALIDATION', "You can't remove your own Admin role.");
    }
    if (normalizeEmail(before.email) !== email) fail('VALIDATION', "The email address of an existing account can't be changed.");
    const accountEmail = normalizeEmail(before.email ?? '');
    const existingRoles = priorRoles;
    try {
      for (const role of existingRoles) if (!roles.includes(role)) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role }));
      for (const role of roles) if (!existingRoles.includes(role)) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role }));
      const updated = check(await db.models.TeamMember.update({ id: before.id, name, username, role: roles[0] as typeof VALID[number], roles, jobTitle: input.jobTitle?.trim() || null, skills: input.skills ?? [], weeklyCapacityHours: capacity, avatarKey: input.avatarKey === undefined ? before.avatarKey : input.avatarKey }), 'TeamMember.update');
      if (!updated) fail('NOT_FOUND', 'This member no longer exists.');
      return updated;
    } catch (error) {
      for (const role of roles) if (!existingRoles.includes(role)) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role })).catch(() => undefined);
      for (const role of existingRoles) if (!roles.includes(role)) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: accountEmail, GroupName: role })).catch(() => undefined);
      throw error;
    }
  }
  if (!input.memberId) fail('VALIDATION', 'The member id is required.');
  const member = check(await db.models.TeamMember.get({ id: input.memberId }), 'TeamMember.get');
  if (!member) fail('NOT_FOUND', 'This member no longer exists.');
  await ensureOrganisationAccess(member.organisationId, caller.email, caller.roles);
  const assignedRoles = (member.roles?.length ? member.roles : [member.role ?? 'VIEWER']).filter((role): role is string => !!role);
  if (assignedRoles.some((r) => r === 'ADMIN' || r === 'PROJECT_MANAGER') && !caller.roles.includes('ADMIN')) fail('FORBIDDEN', "Only an administrator can delete a manager's account.");
  if (normalizeEmail(member.email ?? '') === caller.email) fail('FORBIDDEN', "You can't delete your own account.");
  let token: string | null | undefined; do { const page = await db.models.Task.list({ filter: { assigneeId: { eq: member.id } }, nextToken: token, limit: 1000 }); if (check(page, 'Task.list').some((t) => !['DONE', 'CANCELLED'].includes(t.status ?? 'TODO'))) fail('VALIDATION', 'Reassign or close the open tasks before deleting this account.'); token = page.nextToken; } while (token);
  const memberEmail = normalizeEmail(member.email ?? '');
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: memberEmail }));
  try { check(await db.models.TeamMember.delete({ id: member.id }), 'TeamMember.delete'); await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: memberEmail })); }
  catch (error) { await cognito.send(new AdminEnableUserCommand({ UserPoolId: pool, Username: memberEmail })).catch(() => undefined); throw error; }
  return member;
});
