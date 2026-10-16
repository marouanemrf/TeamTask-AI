import { env } from "$amplify/env/log-event";
import type { Schema } from "../../data/resource";
import { findEventByRequestId } from "../shared/audit";
import { check, createDataClient } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { isManagerRole } from "../shared/rules";
import * as v from "../shared/validate";

const client = await createDataClient(env);

const EVENT_TYPES = ["CREATED", "UPDATED", "ASSIGNED", "STATUS_CHANGED", "APPROVED", "REJECTED", "REMINDER_SENT", "ESCALATED"] as const;

function toJson(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (json.length > 20000) fail("VALIDATION", "The audit data is too large.");
  return json;
}

/**
 * Audit events for non-task records (projects, members, milestones, organisation), written by
 * managers' actions. The actor email always comes from the signed-in identity. Task events are
 * refused here: only the task functions may write them.
 */
export const handler: Schema["logEvent"]["functionHandler"] = (event) =>
  runMutation("log-event", event, async (caller, args) => {
    if (!isManagerRole(caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can record audit events.");

    const entityId = v.id(args.entityId, "Entity");
    const eventType = args.eventType;
    if (!(EVENT_TYPES as readonly unknown[]).includes(eventType)) fail("VALIDATION", "Unknown event type.");
    const actorType = args.actorType === "SYSTEM" ? "SYSTEM" : "USER";
    const requestId = args.clientRequestId ? v.requestId(args.clientRequestId) : undefined;

    if (requestId) {
      const previous = await findEventByRequestId(client, requestId);
      if (previous) return previous;
    }
    const task = check(await client.models.Task.get({ id: entityId }), "Task.get");
    if (task) fail("VALIDATION", "Task events are recorded only by the task API.");

    const created = check(
      await client.models.TaskEvent.create({
        entityId,
        eventType: eventType as (typeof EVENT_TYPES)[number],
        actorType,
        actorEmail: caller.email,
        before: toJson(args.before),
        after: toJson(args.after),
        requestId,
      }),
      "TaskEvent.create",
    );
    if (!created) throw new Error("TaskEvent.create returned no data");
    return created;
  });
