import { env } from "$amplify/env/update-task";
import type { Schema } from "../../data/resource";
import { findEventByRequestId, snapshot, writeEvent } from "../shared/audit";
import { check, createDataClient, getAssignee, getProject, getTask, listDependencies, listProjectTasks, setDependencies } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { canPerform, dependsOnIds, descendantIds, dueDateWarning, wouldCreateCycle } from "../shared/rules";
import * as v from "../shared/validate";

const client = await createDataClient(env);

/**
 * Edits a task's fields and dependencies (managers). Status changes go through changeTaskStatus,
 * cancellation through cancelTask. Logs UPDATED, plus ASSIGNED when the assignee changes.
 */
export const handler: Schema["editTask"]["functionHandler"] = (event) =>
  runMutation("update-task", event, async (caller, args) => {
    if (!canPerform("update", caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can edit tasks.");

    const requestId = v.requestId(args.clientRequestId);
    const taskId = v.id(args.taskId, "Task");
    const previous = await findEventByRequestId(client, requestId);
    if (previous) return getTask(client, previous.entityId);

    const before = await getTask(client, taskId);
    if (before.status === "CANCELLED") fail("VALIDATION", "A cancelled task can't be edited.");
    const project = await getProject(client, before.projectId);

    // --- Validate input ---
    const title = v.text(args.title, "Title", { max: 200 });
    const description = v.optionalText(args.description, "Description", 5000);
    const priority = v.priority(args.priority, before.priority ?? "MEDIUM");
    const dueDate = v.optionalDate(args.dueDate, "Due date");
    const estimatedHours = v.optionalHours(args.estimatedHours);
    const requiredSkills = v.skills(args.requiredSkills);
    // Every task has an assignee who can work on it (no unassigned tasks).
    if (!args.assigneeId) fail("VALIDATION", "Every task must be assigned to a team member.");
    const assigneeId = v.id(args.assigneeId, "Assignee");
    const parentTaskId = v.optionalId(args.parentTaskId, "Parent task");
    const requestedDeps = v.idList(args.dependsOn, "Dependencies");

    // --- Business rules ---
    const projectTasks = await listProjectTasks(client, project.id);
    const inProject = new Set(projectTasks.map((t) => t.id));
    const deps = await listDependencies(client, inProject);
    const dependsOn = requestedDeps ?? dependsOnIds(taskId, deps); // omitted = keep current links

    if (parentTaskId) {
      if (!inProject.has(parentTaskId)) fail("VALIDATION", "The parent task must belong to the same project.");
      if (parentTaskId === taskId || descendantIds(taskId, projectTasks).has(parentTaskId)) {
        fail("VALIDATION", "A task can't be its own parent or the parent of one of its ancestors.");
      }
    }
    if (dependsOn.some((id) => !inProject.has(id))) fail("VALIDATION", "Dependencies must belong to the same project.");
    if (wouldCreateCycle(taskId, dependsOn, deps)) fail("VALIDATION", "These dependencies would create a circular dependency.");
    await getAssignee(client, assigneeId, project.organisationId);
    const warning = dueDateWarning(dueDate, project.startDate, project.endDate);
    if (warning) console.info(JSON.stringify({ fn: "update-task", warning, taskId, dueDate }));

    // --- Write ---
    const updated = check(
      await client.models.Task.update({ id: taskId, title, description, priority, dueDate, estimatedHours, requiredSkills, assigneeId, parentTaskId }),
      "Task.update",
    );
    if (!updated) throw new Error("Task.update returned no data");
    await setDependencies(client, taskId, dependsOn, deps);

    await writeEvent(client, {
      entityId: taskId,
      eventType: "UPDATED",
      actorEmail: caller.email,
      before: { ...snapshot(before), dependsOn: dependsOnIds(taskId, deps) },
      after: { ...snapshot(updated), dependsOn },
      requestId,
    });
    if ((before.assigneeId ?? null) !== (updated.assigneeId ?? null)) {
      await writeEvent(client, {
        entityId: taskId,
        eventType: "ASSIGNED",
        actorEmail: caller.email,
        before: { assigneeId: before.assigneeId ?? null },
        after: { assigneeId: updated.assigneeId ?? null },
        requestId,
      });
    }
    return updated;
  });
