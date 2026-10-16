import { client } from "./client";
import type { ActorType, TaskEvent, TaskEventType } from "./client";

export interface AuditEvent {
  entityId: string;
  eventType: TaskEventType;
  /** SYSTEM for seed data; the actor email always comes from the signed-in identity (server-side). */
  actorType?: Extract<ActorType, "USER" | "SYSTEM">;
  before?: unknown;
  after?: unknown;
}

// AWSJSON arguments are sent as JSON strings.
function toJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

/**
 * Audit log for non-task records (projects, members, milestones, organisation), written by the
 * log-event function: TaskEvent is read-only for the client and task events are written by the
 * task functions themselves.
 * Never throws: a failed audit write is reported but must not break the user action.
 * Returns whether the event was stored.
 */
export async function logEvent(event: AuditEvent): Promise<boolean> {
  try {
    const { errors } = await client.mutations.logEvent({
      clientRequestId: crypto.randomUUID(),
      entityId: event.entityId,
      eventType: event.eventType,
      actorType: event.actorType ?? "USER",
      before: toJson(event.before),
      after: toJson(event.after),
    });
    if (errors?.length) {
      console.warn("[auditService] Event rejected", errors);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[auditService] Event not written", err);
    return false;
  }
}

/** Live history of one entity (task, project, member…). Reading is allowed to any signed-in user. */
export function observeEntityEvents(
  entityId: string,
  onChange: (events: TaskEvent[]) => void,
  onError: (err: unknown) => void,
): () => void {
  const subscription = client.models.TaskEvent.observeQuery({ filter: { entityId: { eq: entityId } } }).subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

/** Live list of every event of one type (e.g. STATUS_CHANGED, to show blocker reasons and completion dates). */
export function observeEventsByType(
  eventType: TaskEventType,
  onChange: (events: TaskEvent[]) => void,
  onError: (err: unknown) => void,
): () => void {
  const subscription = client.models.TaskEvent.observeQuery({ filter: { eventType: { eq: eventType } } }).subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}
