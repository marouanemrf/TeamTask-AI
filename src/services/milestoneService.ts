import { ApiError } from "./apiError";
import { logEvent } from "./auditService";
import { client } from "./client";
import type { Milestone } from "./client";
import type { AuditActor } from "./teamService";

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

export async function createMilestone(
  input: { projectId: string; name: string; dueDate?: string },
  actor: AuditActor,
): Promise<Milestone> {
  const { data, errors } = await client.models.Milestone.create({
    projectId: input.projectId,
    name: input.name,
    dueDate: input.dueDate || undefined,
  });
  if (!data || errors?.length) throw ApiError.from(errors, "Milestone creation failed");

  const { id, projectId, name, dueDate } = data;
  await logEvent({ entityId: id, eventType: "CREATED", actorType: actor.type === "SYSTEM" ? "SYSTEM" : "USER", after: { id, projectId, name, dueDate } });
  return data;
}
