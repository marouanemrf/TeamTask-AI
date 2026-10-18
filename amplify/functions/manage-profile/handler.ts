import { AdminAddUserToGroupCommand, AdminListGroupsForUserCommand, AdminRemoveUserFromGroupCommand, CognitoIdentityProviderClient, CreateGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { env } from '$amplify/env/manage-profile';
import type { Schema } from '../../data/resource';
import { getCaller } from '../shared/auth';
import { check, createDataClient } from '../shared/data';
import { TaskApiError, fail, toClientMessage } from '../shared/errors';
import { runMutation } from '../shared/handler';
import { organisationGroupsFor } from '../shared/tenancy';
import { normalizeUsername } from '../shared/text';
import * as v from '../shared/validate';

const db = await createDataClient(env);
// Self-service photos live under profile-avatars/<identityId>/ (only the owner can write there).
const OWN_PHOTO = /^profile-avatars\/[A-Za-z0-9:_-]+\/[A-Za-z0-9._-]+$/;
const ROLES = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const;

async function listAll<T>(load: (nextToken: string | null | undefined) => Promise<{ data: T[]; errors?: readonly { message: string }[]; nextToken?: string | null }>, what: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await load(nextToken);
    items.push(...check(page as { data: T[]; errors?: { message: string }[] }, what));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

/** A username derived from the email that no one in the organisation uses yet. */
function freeUsername(email: string, taken: Set<string>): string {
  const base = normalizeUsername(email.split('@')[0]).replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 26) || 'admin';
  let candidate = base.length >= 3 ? base : `${base}-adm`;
  for (let i = 2; taken.has(candidate); i += 1) candidate = `${base}-${i}`;
  return candidate;
}

/**
 * The signed-in user edits their own team profile (matched by the email of the session).
 * - The job title is set by managers on the Team page; only an ADMIN may change their own here.
 * - An ADMIN without a team profile yet (account created in Cognito and added to the organisation
 *   groups) gets one in their organisation on first save.
 */
const updateMyProfile: Schema['updateMyProfile']['functionHandler'] = (event) => runMutation('update-my-profile', event, async (caller, args) => {
  const phone = args.phoneNumber?.trim();
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) fail('VALIDATION', 'Enter a valid phone number.');
  for (const value of [args.name, args.jobTitle, args.experience, args.education, args.professionalSummary]) if (value && value.length > 5000) fail('VALIDATION', 'A profile field is longer than allowed.');
  if ((args.skills ?? []).some((skill) => !skill?.trim() || skill.length > 80)) fail('VALIDATION', 'A skill is empty or too long.');
  const unavailableFrom = v.optionalDate(args.unavailableFrom, 'Absence start');
  const unavailableUntil = v.optionalDate(args.unavailableUntil, 'Absence end');
  if (unavailableFrom && unavailableUntil && unavailableUntil < unavailableFrom) fail('VALIDATION', 'The end of the absence must be on or after its start.');
  const isAdmin = caller.roles.includes('ADMIN');

  const members = await listAll((nextToken) => db.models.TeamMember.list({ nextToken, limit: 1000 }), 'TeamMember.list');
  const mine = members.find((m) => m.email.toLowerCase() === caller.email);

  const fields = {
    phoneNumber: phone || null,
    experience: args.experience?.trim() || null,
    education: args.education?.trim() || null,
    professionalSummary: args.professionalSummary?.trim() || null,
    // Omitted = unchanged (older clients); null clears.
    ...(args.unavailableFrom !== undefined ? { unavailableFrom } : {}),
    ...(args.unavailableUntil !== undefined ? { unavailableUntil } : {}),
  };

  if (mine) {
    // A new photo must be a self-service upload; keeping the current one (even if a manager set it) is fine.
    if (args.avatarKey && args.avatarKey !== mine.avatarKey && !OWN_PHOTO.test(args.avatarKey)) fail('VALIDATION', 'Invalid photo path.');
    const updated = check(await db.models.TeamMember.update({
      id: mine.id,
      ...fields,
      name: args.name?.trim() || mine.name,
      // Read-only for everyone but administrators: other values are ignored, the current one is kept.
      jobTitle: isAdmin ? args.jobTitle?.trim() || null : mine.jobTitle ?? null,
      skills: args.skills ?? mine.skills ?? [],
      avatarKey: args.avatarKey === undefined ? mine.avatarKey : args.avatarKey,
    }), 'TeamMember.update');
    if (!updated) fail('NOT_FOUND', 'Your profile no longer exists.');
    return updated;
  }

  if (!isAdmin) fail('NOT_FOUND', "Your team profile wasn't found. Contact an administrator.");

  // First profile of an administrator: in the organisation of their token (see shared/tenancy.ts).
  if (!caller.organisationId) fail('VALIDATION', 'Set up your organisation first.');
  const organisation = check(await db.models.Organisation.get({ id: caller.organisationId }), 'Organisation.get');
  if (!organisation) fail('NOT_FOUND', "Your organisation doesn't exist.");
  const organisationId = organisation.id;
  if (args.avatarKey && !OWN_PHOTO.test(args.avatarKey)) fail('VALIDATION', 'Invalid photo path.');
  const taken = new Set(members.filter((m) => m.organisationId === organisationId).map((m) => normalizeUsername(m.username ?? '')));
  const roles = ROLES.filter((r) => caller.roles.includes(r));
  const created = check(await db.models.TeamMember.create({
    organisationId,
    email: caller.email,
    username: freeUsername(caller.email, taken),
    name: args.name?.trim() || caller.email.split('@')[0],
    role: roles[0] ?? 'ADMIN',
    roles,
    jobTitle: args.jobTitle?.trim() || null,
    skills: args.skills ?? [],
    weeklyCapacityHours: 40,
    avatarKey: args.avatarKey ?? null,
    ...fields,
  }), 'TeamMember.create');
  if (!created) throw new Error('TeamMember.create returned no data');
  console.info(JSON.stringify({ fn: 'update-my-profile', outcome: 'ADMIN_PROFILE_CREATED', memberId: created.id }));
  return created;
});

const cognito = new CognitoIdentityProviderClient({});

/**
 * syncMyAccess: puts the caller in their organisation's groups for the role they have now.
 * Roles are the Cognito role groups (an administrator may change them in the console); the
 * organisation is the one of the caller's team profile. Both are set by administrators only, so
 * the caller can't give themselves access. Also keeps the profile's role fields in line (display).
 * Returns true when the groups changed (the app then refreshes its tokens).
 */
async function syncMyAccess(identity: unknown): Promise<boolean> {
  const caller = await getCaller(identity);
  const pool = process.env.USER_POOL_ID!;
  const members = await listAll((nextToken) => db.models.TeamMember.list({ nextToken, limit: 1000 }), 'TeamMember.list');
  const mine = members.find((m) => m.email.toLowerCase() === caller.email);
  if (!mine?.organisationId) return false;

  const current = ((await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: pool, Username: caller.username, Limit: 60 }))).Groups ?? []).map((g) => g.GroupName ?? '');
  const roles = ROLES.filter((r) => current.includes(r));
  const wanted = new Set(organisationGroupsFor(mine.organisationId, roles));
  let changed = false;
  for (const group of wanted) {
    if (current.includes(group)) continue;
    await cognito.send(new CreateGroupCommand({ UserPoolId: pool, GroupName: group, Description: 'TeamTask organisation (data isolation)' })).catch((e: Error) => { if (e.name !== 'GroupExistsException') throw e; });
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: caller.username, GroupName: group }));
    changed = true;
  }
  // Organisation groups the caller should no longer have (e.g. managers group after a demotion).
  for (const group of current) {
    if ((ROLES as readonly string[]).includes(group) || wanted.has(group)) continue;
    await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool, Username: caller.username, GroupName: group }));
    changed = true;
  }
  const shown = roles.length ? roles : ['VIEWER' as const];
  if (mine.role !== shown[0] || (mine.roles ?? []).join() !== shown.join()) {
    check(await db.models.TeamMember.update({ id: mine.id, role: shown[0], roles: [...shown] }), 'TeamMember.update');
  }
  if (changed) console.info(JSON.stringify({ fn: 'sync-my-access', outcome: 'GROUPS_UPDATED', memberId: mine.id, roles: shown }));
  return changed;
}

// Amplify passes the GraphQL field name at the top level of the event (fieldName, typeName).
export const handler = async (event: Parameters<typeof updateMyProfile>[0] & { fieldName?: string }, ...rest: unknown[]) => {
  if (event.fieldName !== 'syncMyAccess') return (updateMyProfile as (...a: unknown[]) => unknown)(event, ...rest);
  try {
    return await syncMyAccess(event.identity);
  } catch (error) {
    if (error instanceof TaskApiError) throw new Error(toClientMessage(error.code, error.message));
    console.error(JSON.stringify({ fn: 'sync-my-access', outcome: 'ERROR', error: error instanceof Error ? error.stack : String(error) }));
    throw new Error(toClientMessage('INTERNAL', 'Something went wrong on the server. Please try again.'));
  }
};
