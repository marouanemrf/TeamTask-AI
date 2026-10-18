import { env } from "$amplify/env/change-task-status";
import type { Schema } from "../../data/resource";
import { findEventByRequestId, writeEvent } from "../shared/audit";
import { check, createDataClient, getTask, listDependencies, listProjectTasks } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { requireOrganisation } from "../shared/tenancy";
import { canPerform, checkStatusChange, validateBlockReason } from "../shared/rules";
import * as v from "../shared/validate";

const client = await createDataClient(env);

/**
 * Moves a task to another status. Managers: any task; MEMBER: only tasks whose assignee email is
 * theirs. IN_PROGRESS / DONE require finished dependencies; BLOCKED requires a reason.
 */
export const handler: Schema["changeTaskStatus"]["functionHandler"] = (event) =>
  runMutation("change-task-status", event, async (caller, args) => {
    const organisationId = requireOrganisation(caller);
    const requestId = v.requestId(args.clientRequestId);
    const taskId = v.id(args.taskId, "Task");
    const target = v.status(args.status, ["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE"]);

    const task = await getTask(client, taskId, organisationId);

    // --- Permission: managers, or the MEMBER the task is assigned to (matched by email) ---
    let isAssignee = false;
    if (task.assigneeId) {
      const assignee = check(await client.models.TeamMember.get({ id: task.assigneeId }), "TeamMember.get");
      isAssignee = !!assignee && assignee.email.toLowerCase() === caller.email;
    }
    if (!canPerform("changeStatus", caller.roles, { isAssignee })) {
      fail("FORBIDDEN", "You can only change the status of tasks assigned to you.");
    }

    const previous = await findEventByRequestId(client, requestId);
    if (previous) return getTask(client, previous.entityId, organisationId);

    // --- Business rules ---
    if (task.status === "CANCELLED") fail("VALIDATION", "The status of a cancelled task can't be changed.");
    let reason: string | null = null;
    if (target === "BLOCKED") {
      const problem = validateBlockReason(args.reason);
      if (problem) fail("VALIDATION", problem);
      reason = (args.reason ?? "").trim();
    }
    // Same status and nothing new to record: nothing to do.
    if (task.status === target && !reason) return task;

    const projectTasks = await listProjectTasks(client, task.projectId);
    const tasksById = new Map(projectTasks.map((t) => [t.id, { ...t, title: t.title }]));
    const deps = await listDependencies(client, new Set(tasksById.keys()));
    const move = checkStatusChange(task, target, deps, tasksById);
    if (!move.ok) fail("DEPENDENCY", move.reason);

    // --- Write ---
    const updated = check(await client.models.Task.update({ id: taskId, status: target }), "Task.update");
    if (!updated) throw new Error("Task.update returned no data");

    await writeEvent(client, {
      organisationId,
      entityId: taskId,
      eventType: "STATUS_CHANGED",
      actorEmail: caller.email,
      before: { status: task.status ?? null },
      after: reason ? { status: target, reason } : { status: target },
      requestId,
    });
    return updated;
  });
