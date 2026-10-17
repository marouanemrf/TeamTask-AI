import type { Schema } from "../../data/resource";
import { findEventByRequestId, isDuplicateWrite, snapshot, writeEvent } from "./audit";
import { check, getAssignee, getProject, getTask, listDependencies, listProjectTasks, setDependencies } from "./data";
import type { DataClient, TaskRecord } from "./data";
import { fail } from "./errors";
import { dueDateWarning } from "./rules";
import * as v from "./validate";

export interface CreateTaskArgs {
  clientRequestId: string;
  projectId: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  requiredSkills?: (string | null)[] | null;
  assigneeId?: string | null;
  parentTaskId?: string | null;
  dependsOn?: (string | null)[] | null;
}

/**
 * Creates one task with every server rule: validation, same-project parent and dependencies,
 * an assignable assignee, idempotency on clientRequestId (task id = request id) and a CREATED
 * audit event. Used by the addTask mutation (HUMAN) and by the approved AI plans (AI).
 */
export async function createTaskRecord(
  client: DataClient,
  actor: { email: string; actorType?: "USER" | "SYSTEM" },
  args: CreateTaskArgs,
  createdBy: NonNullable<Schema["Task"]["type"]["createdBy"]> = "HUMAN",
): Promise<TaskRecord> {
  const requestId = v.requestId(args.clientRequestId);
  const previous = await findEventByRequestId(client, requestId);
  if (previous) return getTask(client, previous.entityId);

  // --- Validate input ---
  const project = await getProject(client, v.id(args.projectId, "Project"));
  const title = v.text(args.title, "Title", { max: 200 });
  const description = v.optionalText(args.description, "Description", 5000);
  const priority = v.priority(args.priority, "MEDIUM");
  const status = v.status(args.status ?? "TODO", ["PROPOSED", "TODO"]);
  const dueDate = v.optionalDate(args.dueDate, "Due date");
  const estimatedHours = v.optionalHours(args.estimatedHours);
  const requiredSkills = v.skills(args.requiredSkills);
  // Every task has an assignee who can work on it (no unassigned tasks).
  if (!args.assigneeId) fail("VALIDATION", "Every task must be assigned to a team member.");
  const assigneeId = v.id(args.assigneeId, "Assignee");
  const parentTaskId = v.optionalId(args.parentTaskId, "Parent task");
  const dependsOn = v.idList(args.dependsOn, "Dependencies") ?? [];

  // --- Business rules ---
  const projectTasks = await listProjectTasks(client, project.id);
  const inProject = new Set(projectTasks.map((t) => t.id));
  if (parentTaskId && !inProject.has(parentTaskId)) fail("VALIDATION", "The parent task must belong to the same project.");
  if (dependsOn.some((id) => !inProject.has(id))) fail("VALIDATION", "Dependencies must belong to the same project.");
  await getAssignee(client, assigneeId, project.organisationId);
  const warning = dueDateWarning(dueDate, project.startDate, project.endDate);
  if (warning) console.info(JSON.stringify({ fn: "create-task", warning, projectId: project.id, dueDate }));

  // --- Write ---
  // parentTaskId is a GSI key (subtasks): DynamoDB rejects a NULL key value, so a top-level task
  // must omit it instead of sending null. (assigneeId, also a GSI key, is always set.)
  // The task id is the clientRequestId: a concurrent retry of the same request fails on the
  // existing id (conditional create) and returns the task created by the first one.
  const result = await client.models.Task.create({
    id: requestId,
    projectId: project.id,
    title,
    description,
    priority,
    status,
    dueDate,
    estimatedHours,
    requiredSkills,
    assigneeId,
    ...(parentTaskId ? { parentTaskId } : {}),
    createdBy,
  });
  if (isDuplicateWrite(result.errors)) return getTask(client, requestId);
  const created = check(result, "Task.create");
  if (!created) throw new Error("Task.create returned no data");

  // A brand-new task can't be part of a cycle: nothing depends on it yet.
  if (dependsOn.length) await setDependencies(client, created.id, dependsOn, await listDependencies(client, inProject));

  await writeEvent(client, {
    entityId: created.id,
    eventType: "CREATED",
    actorEmail: actor.email,
    actorType: actor.actorType,
    after: { ...snapshot(created), dependsOn },
    requestId,
  });
  return created;
}
