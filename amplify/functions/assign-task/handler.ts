import { env } from "$amplify/env/assign-task";
import type { Schema } from "../../data/resource";
import { findEventByRequestId, writeEvent } from "../shared/audit";
import { check, createDataClient, getAssignee, getProject, getTask } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { canPerform } from "../shared/rules";
import * as v from "../shared/validate";

const client = await createDataClient(env);

/** Changes (or clears) a task's assignee (managers) and logs ASSIGNED. */
export const handler: Schema["assignTask"]["functionHandler"] = (event) =>
  runMutation("assign-task", event, async (caller, args) => {
    if (!canPerform("assign", caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can assign tasks.");

    const requestId = v.requestId(args.clientRequestId);
    const taskId = v.id(args.taskId, "Task");
    const previous = await findEventByRequestId(client, requestId);
    if (previous) return getTask(client, previous.entityId);

    const task = await getTask(client, taskId);
    if (task.status === "CANCELLED") fail("VALIDATION", "A cancelled task can't be reassigned.");
    // A task can be reassigned, never left without an assignee.
    if (!args.assigneeId) fail("VALIDATION", "Every task must be assigned to a team member.");
    const assigneeId = v.id(args.assigneeId, "Assignee");
    const project = await getProject(client, task.projectId);
    await getAssignee(client, assigneeId, project.organisationId);
    if ((task.assigneeId ?? null) === assigneeId) return task;

    const updated = check(await client.models.Task.update({ id: taskId, assigneeId }), "Task.update");
    if (!updated) throw new Error("Task.update returned no data");

    await writeEvent(client, {
      entityId: taskId,
      eventType: "ASSIGNED",
      actorEmail: caller.email,
      before: { assigneeId: task.assigneeId ?? null },
      after: { assigneeId },
      requestId,
    });
    return updated;
  });
