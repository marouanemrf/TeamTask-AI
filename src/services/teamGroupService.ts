import type { Schema } from "../../amplify/data/resource";
import { ApiError } from "./apiError";
import { logEvent } from "./auditService";
import { client } from "./client";

/** Teams inside the organisation (e.g. "Cloud security", "GRC"). Managers create and delete them. */
export type TeamGroup = Schema["Team"]["type"];

export function observeTeams(organisationId: string, onChange: (teams: TeamGroup[]) => void, onError: (err: unknown) => void): () => void {
  const sub = client.models.Team.observeQuery({ filter: { organisationId: { eq: organisationId } } }).subscribe({
    next: ({ items }) => onChange([...items].sort((a, b) => a.name.localeCompare(b.name))),
    error: onError,
  });
  return () => sub.unsubscribe();
}

export async function createTeam(organisationId: string, input: { name: string; description?: string; leadMemberId?: string | null }): Promise<TeamGroup> {
  const { data, errors } = await client.models.Team.create({ organisationId, name: input.name.trim(), description: input.description?.trim() || null, leadMemberId: input.leadMemberId || null });
  if (!data || errors?.length) throw ApiError.from(errors, "The team couldn't be created.");
  await logEvent({ entityId: data.id, eventType: "CREATED", actorType: "USER", after: { name: data.name, leadMemberId: data.leadMemberId } });
  return data;
}

/** Deletes an empty team (members must be moved out first, so no member points to a missing team). */
export async function deleteTeam(team: TeamGroup, memberCount: number): Promise<void> {
  if (memberCount > 0) throw new ApiError("Move the members to another team before deleting this one.", "VALIDATION");
  const { errors } = await client.models.Team.delete({ id: team.id });
  if (errors?.length) throw ApiError.from(errors, "The team couldn't be deleted.");
  await logEvent({ entityId: team.id, eventType: "STATUS_CHANGED", actorType: "USER", before: { name: team.name }, after: { deleted: true } });
}
