import { fail } from "./errors";
import { ROLES } from "./rules";

/**
 * Organisation-level data isolation (tenant boundary).
 *
 * Every user belongs to two Cognito groups per organisation, managed only by the server:
 * - `<organisationId>`           every member: read access to the organisation's data;
 * - `<organisationId>:MANAGERS`  ADMIN and PROJECT_MANAGER: read access to manager-only data
 *                                (AI recommendations, approvals, reminders, escalations).
 * AppSync filters every read with these groups (allow.groupDefinedIn on `organisationId` and
 * `managersGroup`), subscriptions included. The functions check the same boundary on each call.
 */
export const managersGroupOf = (organisationId: string) => `${organisationId}:MANAGERS`;

/** The organisation groups a member with these roles must be in. */
export function organisationGroupsFor(organisationId: string, roles: readonly string[]): string[] {
  const manager = roles.includes("ADMIN") || roles.includes("PROJECT_MANAGER");
  return manager ? [organisationId, managersGroupOf(organisationId)] : [organisationId];
}

/** The organisation id carried by the token groups (the one group that is neither a role nor a managers group). */
export function organisationFromGroups(groups: readonly string[] | null | undefined): string | undefined {
  const ids = (groups ?? []).filter((g) => !(ROLES as readonly string[]).includes(g) && !g.includes(":"));
  return ids.length === 1 ? ids[0] : undefined;
}

/** The caller's organisation, or FORBIDDEN when the account isn't linked to exactly one. */
export function requireOrganisation(caller: { organisationId?: string }): string {
  if (!caller.organisationId) fail("FORBIDDEN", "Your account isn't linked to an organisation. Sign out, then sign in again; if it persists, contact an administrator.");
  return caller.organisationId;
}

/**
 * A record of another organisation is reported as not found: the caller learns nothing about it.
 * Records written before isolation have no organisation and are refused too.
 */
export function assertSameOrganisation(record: { organisationId?: string | null } | null | undefined, organisationId: string, what: string): void {
  if (!record || record.organisationId !== organisationId) fail("NOT_FOUND", `${what} doesn't exist.`);
}

/** Fields that place a new record in the organisation (and, for manager-only data, its managers group). */
export const inOrganisation = (organisationId: string) => ({ organisationId });
export const forManagers = (organisationId: string) => ({ organisationId, managersGroup: managersGroupOf(organisationId) });
