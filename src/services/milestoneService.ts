import { ApiError } from "./apiError";
import { client } from "./client";
import type { Milestone } from "./client";

/** Live list of a project's milestones. Returns an unsubscribe function. */
export function observeMilestones(
  projectId: string,
  onChange: (milestones: Milestone[]) => void,
  onError: (err: unknown) => void,
): () => void {
  const subscription = client.models.Milestone.observeQuery({ filter: { projectId: { eq: projectId } } }).subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

/** Adds a milestone (managers); the server checks the project's organisation and audits it. */
export async function createMilestone(
  input: { projectId: string; name: string; dueDate?: string },
): Promise<Milestone> {
  const { data, errors } = await client.mutations.addMilestone({
    projectId: input.projectId,
    name: input.name,
    dueDate: input.dueDate || undefined,
  });
  if (!data || errors?.length) throw ApiError.from(errors, "Milestone creation failed");
  return data;
}
