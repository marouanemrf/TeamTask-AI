import type { Schema } from "../../data/resource";
import { check } from "./data";
import type { DataClient, TaskRecord } from "./data";

type TaskEventType = NonNullable<Schema["TaskEvent"]["type"]["eventType"]>;

export interface AuditInput {
  /** Organisation of the audited record: only its members can read the event. */
  organisationId: string;
  entityId: string;
  eventType: TaskEventType;
  actorEmail: string;
  actorType?: "USER" | "SYSTEM";
  before?: unknown;
  after?: unknown;
  requestId: string;
}

/** Business fields of a task, for before/after snapshots. */
export function snapshot(task: TaskRecord) {
  const { id, projectId, parentTaskId, title, description, status, priority, dueDate, estimatedHours, requiredSkills, createdBy, assigneeId } = task;
  return { id, projectId, parentTaskId, title, description, status, priority, dueDate, estimatedHours, requiredSkills, createdBy, assigneeId };
}

/** Idempotency: the event already written for this clientRequestId, if any (secondary index on requestId). */
export async function findEventByRequestId(client: DataClient, requestId: string) {
  const events = check(await client.models.TaskEvent.listTaskEventByRequestId({ requestId }), "TaskEvent.byRequestId");
  return events[0] ?? null;
}

/** DynamoDB rejected a create because the id already exists (conditional write). */
export function isDuplicateWrite(errors: readonly { errorType?: string | null; message: string }[] | undefined): boolean {
  return !!errors?.some((e) => (e.errorType ?? "").includes("ConditionalCheckFailed") || e.message.includes("conditional request failed"));
}

/**
 * Writes one business audit event. AWSJSON fields are sent as JSON strings.
 * The id is derived from the request (`<requestId>:<eventType>`), so a repeated or concurrent
 * request can never record the same event twice: the second create fails on the existing id
 * and is ignored. Returns false when the event already existed.
 */
export async function writeEvent(client: DataClient, input: AuditInput): Promise<boolean> {
  const result = await client.models.TaskEvent.create({
      id: `${input.requestId}:${input.eventType}`,
      organisationId: input.organisationId,
      entityId: input.entityId,
      eventType: input.eventType,
      actorType: input.actorType ?? "USER",
      actorEmail: input.actorEmail,
      before: input.before === undefined ? undefined : JSON.stringify(input.before),
      after: input.after === undefined ? undefined : JSON.stringify(input.after),
      requestId: input.requestId,
    });
  if (isDuplicateWrite(result.errors)) return false;
  check(result, "TaskEvent.create");
  return true;
}
