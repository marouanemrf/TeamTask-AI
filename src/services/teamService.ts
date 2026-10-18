import { getUrl, remove, uploadData } from "aws-amplify/storage";
import { ApiError } from "./apiError";
import { client } from "./client";
import type { TeamMember, TeamRole } from "./client";
import { normalizeEmail, normalizeUsername } from "../utils/text";

/** Editable fields of a team member (organisationId and avatarKey are set by the service). */
export interface MemberInput {
  name: string;
  email: string;
  username: string;
  roles: TeamRole[];
  jobTitle?: string;
  skills: string[];
  weeklyCapacityHours: number;
  /** Team inside the organisation; null = none. */
  teamId?: string | null;
}

/** What to do with the profile picture when saving. */
export type AvatarChange = { kind: "keep" } | { kind: "remove" } | { kind: "replace"; image: Blob };
export const KEEP_AVATAR: AvatarChange = { kind: "keep" };

export const DUPLICATE_EMAIL = "DuplicateEmail";
export const DUPLICATE_USERNAME = "DuplicateUsername";
export const AVATAR_UPLOAD_FAILED = "AvatarUploadFailed";

/* -------------------------------------------------------------------------- */
/* Profile pictures (S3, path avatars/*)                                       */
/* -------------------------------------------------------------------------- */

/** Uploads an already-resized image and returns its storage path. */
async function uploadAvatar(image: Blob): Promise<string> {
  const extension = image.type === "image/webp" ? "webp" : "jpg";
  const path = `avatars/${crypto.randomUUID()}.${extension}`;
  try {
    await uploadData({ path, data: image, options: { contentType: image.type } }).result;
    return path;
  } catch (err) {
    console.error("[teamService] Avatar upload failed", err);
    throw new ApiError("Profile picture upload failed", AVATAR_UPLOAD_FAILED);
  }
}

/** Best effort: an orphaned picture is harmless, so failures are only logged. */
async function removeAvatar(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await remove({ path });
  } catch (err) {
    console.warn("[teamService] Avatar removal failed", err);
  }
}

/** Signed, temporary URL for displaying a profile picture. */
export async function getAvatarUrl(path: string): Promise<{ url: string; expiresAt: Date }> {
  const { url, expiresAt } = await getUrl({ path, options: { expiresIn: 3600 } });
  return { url: url.toString(), expiresAt };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Live list of the organisation's members. Returns an unsubscribe function.
 * No organisationId filter in the query: the data API already returns only the caller's
 * organisation, and that field (the isolation group) can't be used in subscription filters.
 */
export function observeTeamMembers(
  organisationId: string,
  onChange: (members: TeamMember[]) => void,
  onError: (err: unknown) => void,
): () => void {
  const subscription = client.models.TeamMember.observeQuery().subscribe({
    next: ({ items }) => onChange(items.filter((m) => m.organisationId === organisationId)),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

/** Every member of the organisation (paginated). */
export async function listTeamMembers(organisationId: string): Promise<TeamMember[]> {
  const members: TeamMember[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: token } = await client.models.TeamMember.list({
      filter: { organisationId: { eq: organisationId } },
      nextToken,
    });
    if (errors?.length) throw ApiError.from(errors, "Team member list failed");
    members.push(...data);
    nextToken = token;
  } while (nextToken);
  return members;
}

/** IDs of the TeamMember records whose email matches (case-insensitive) — used to find "my" tasks. */
export async function findTeamMemberIdsByEmail(email: string): Promise<string[]> {
  const target = normalizeEmail(email);
  const ids: string[] = [];
  let nextToken: string | null | undefined;

  // Matched client-side because DynamoDB filters are case-sensitive; paginate through all pages.
  do {
    const { data, errors, nextToken: token } = await client.models.TeamMember.list({ nextToken });
    if (errors?.length) throw ApiError.from(errors, "Team member lookup failed");
    for (const member of data) {
      if (normalizeEmail(member.email) === target) ids.push(member.id);
    }
    nextToken = token;
  } while (nextToken);

  return ids;
}

/** Throws a Duplicate* ApiError if another member of the organisation uses this email or username. */
async function assertUnique(organisationId: string, input: MemberInput, exceptId?: string): Promise<void> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const others = (await listTeamMembers(organisationId)).filter((m) => m.id !== exceptId);
  if (others.some((m) => normalizeEmail(m.email) === email)) {
    throw new ApiError("A member with this email already exists in the organisation", DUPLICATE_EMAIL);
  }
  if (others.some((m) => m.username && normalizeUsername(m.username) === username)) {
    throw new ApiError("This username is already taken in the organisation", DUPLICATE_USERNAME);
  }
}

function toRecordFields(input: MemberInput) {
  return {
    name: input.name,
    email: input.email.trim(),
    username: normalizeUsername(input.username),
    role: input.roles[0] ?? "VIEWER",
    roles: input.roles,
    skills: input.skills,
    weeklyCapacityHours: input.weeklyCapacityHours,
    ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes (each one is audited by the manage-team-member function)            */
/* -------------------------------------------------------------------------- */

export async function createTeamMember(
  organisationId: string,
  input: MemberInput,
  avatar: AvatarChange = KEEP_AVATAR,
): Promise<TeamMember> {
  await assertUnique(organisationId, input);
  const avatarKey = avatar.kind === "replace" ? await uploadAvatar(avatar.image) : undefined;

  const { data, errors } = await client.mutations.manageTeamMember({
    action: "CREATE",
    ...toRecordFields(input),
    organisationId,
    jobTitle: input.jobTitle || undefined,
    avatarKey,
  });
  if (!data || errors?.length) {
    await removeAvatar(avatarKey); // don't leave an orphaned upload behind
    throw ApiError.from(errors, "Team member creation failed");
  }

  return data;
}

export async function updateTeamMember(
  before: TeamMember,
  input: MemberInput,
  avatar: AvatarChange = KEEP_AVATAR,
): Promise<TeamMember> {
  await assertUnique(before.organisationId, input, before.id);
  const uploaded = avatar.kind === "replace" ? await uploadAvatar(avatar.image) : undefined;
  const avatarKey = avatar.kind === "keep" ? before.avatarKey : (uploaded ?? null);

  const { data, errors } = await client.mutations.manageTeamMember({
    action: "UPDATE",
    organisationId: before.organisationId,
    ...toRecordFields(input),
    memberId: before.id,
    jobTitle: input.jobTitle || null,
    avatarKey,
  });
  if (!data || errors?.length) {
    await removeAvatar(uploaded);
    throw ApiError.from(errors, "Team member update failed");
  }
  // The record now points to the new picture (or none): the old file can go.
  if (avatar.kind !== "keep") await removeAvatar(before.avatarKey);

  return data;
}

/** Deletes a member and their picture. Callers must check there are no open tasks first. */
export async function deleteTeamMember(member: TeamMember): Promise<void> {
  const { errors } = await client.mutations.manageTeamMember({ action: "DELETE", memberId: member.id });
  if (errors?.length) throw ApiError.from(errors, "Team member deletion failed");
  await removeAvatar(member.avatarKey);
}
