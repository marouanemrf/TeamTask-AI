import { env } from "$amplify/env/cancel-task";
import type { Schema } from "../../data/resource";
import { findEventByRequestId, writeEvent } from "../shared/audit";
import { check, createDataClient, getTask } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { requireOrganisation } from "../shared/tenancy";
import { canPerform } from "../shared/rules";
import * as v from "../shared/validate";

const client = await createDataClient(env);

/** Cancels a task (managers): status CANCELLED, never deleted. Logs STATUS_CHANGED. */
export const handler: Schema["cancelTask"]["functionHandler"] = (event) =>
  runMutation("cancel-task", event, async (caller, args) => {
    const organisationId = requireOrganisation(caller);
    if (!canPerform("cancel", caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can cancel tasks.");

    const requestId = v.requestId(args.clientRequestId);
    const taskId = v.id(args.taskId, "Task");
    const previous = await findEventByRequestId(client, requestId);
    if (previous) return getTask(client, previous.entityId, organisationId);

    const task = await getTask(client, taskId, organisationId);
    if (task.status === "CANCELLED") return task;
    const reason = v.optionalText(args.reason, "Reason", 500);

    const updated = check(await client.models.Task.update({ id: taskId, status: "CANCELLED" }), "Task.update");
    if (!updated) throw new Error("Task.update returned no data");

    await writeEvent(client, {
      organisationId,
      entityId: taskId,
      eventType: "STATUS_CHANGED",
      actorEmail: caller.email,
      before: { status: task.status ?? null },
      after: reason ? { status: "CANCELLED", reason } : { status: "CANCELLED" },
      requestId,
    });
    return updated;
  });
