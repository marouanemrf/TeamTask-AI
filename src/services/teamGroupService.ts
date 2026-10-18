import type { Schema } from "../../amplify/data/resource";
import { ApiError } from "./apiError";
import { client } from "./client";

/** Teams inside the organisation (e.g. "Cloud security", "GRC"). Administrators create and delete them. */
export type TeamGroup = Schema["Team"]["type"];

/** False when the connected backend predates the Team model (e.g. an older sandbox): no teams then. */
export const teamsAvailable = () => !!(client.models as Partial<typeof client.models>).Team;

export function observeTeams(organisationId: string, onChange: (teams: TeamGroup[]) => void, onError: (err: unknown) => void): () => void {
  if (!teamsAvailable()) {
    console.warn("[teamGroupService] The backend has no Team model yet: deploy the backend to use teams.");
    onChange([]);
    return () => undefined;
  }
  // No organisationId filter: the data API already scopes the teams to the caller's organisation,
  // and that field (the isolation group) can't be used in subscription filters.
  const sub = client.models.Team.observeQuery().subscribe({
    next: ({ items }) => onChange(items.filter((t) => t.organisationId === organisationId).sort((a, b) => a.name.localeCompare(b.name))),
    error: onError,
  });
  return () => sub.unsubscribe();
}

/** Creates a team in the administrator's organisation (taken from the session server-side; audited). */
export async function createTeam(input: { name: string; description?: string; leadMemberId?: string | null }): Promise<TeamGroup> {
  const { data, errors } = await client.mutations.manageTeam({ action: "CREATE", name: input.name.trim(), description: input.description?.trim() || null, leadMemberId: input.leadMemberId || null });
  if (!data || errors?.length) throw ApiError.from(errors, "The team couldn't be created.");
  return data;
}

/** Deletes an empty team (members must be moved out first, so no member points to a missing team). */
export async function deleteTeam(team: TeamGroup, memberCount: number): Promise<void> {
  if (memberCount > 0) throw new ApiError("Move the members to another team before deleting this one.", "VALIDATION");
  const { errors } = await client.mutations.manageTeam({ action: "DELETE", teamId: team.id });
  if (errors?.length) throw ApiError.from(errors, "The team couldn't be deleted.");
}
