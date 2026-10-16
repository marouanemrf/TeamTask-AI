import { ApiError } from "./apiError";
import { client } from "./client";
import type { Task, TaskPriority, TaskStatus } from "./client";

/**
 * Task API. Every write goes through a Lambda mutation that enforces the business rules
 * server-side and writes the audit log; Task and TaskEvent are read-only for the client.
 * Each call sends a fresh clientRequestId (UUID) so a retried request is applied once.
 */

/** Editable task fields. */
export interface TaskInput {
  projectId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string; // YYYY-MM-DD
  estimatedHours?: number;
  requiredSkills: string[];
  assigneeId?: string;
  parentTaskId?: string;
}

type MutationResult = { data?: Task | null; errors?: readonly { message: string; errorType?: string }[] };

/** Unwraps a mutation result; server rejections ("[CODE] message") become ApiError with that code. */
function unwrap(result: MutationResult, fallback: string): Task {
  if (result.errors?.length || !result.data) throw ApiError.from(result.errors, fallback);
  return result.data;
}

const emptyToNull = (value: string | undefined) => (value ? value : null);

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Live list of all tasks the user can read. Returns an unsubscribe function. */
export function observeTasks(onChange: (tasks: Task[]) => void, onError: (err: unknown) => void): () => void {
  const subscription = client.models.Task.observeQuery().subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

/** Live list of one project's tasks. */
export function observeProjectTasks(
  projectId: string,
  onChange: (tasks: Task[]) => void,
  onError: (err: unknown) => void,
): () => void {
  const subscription = client.models.Task.observeQuery({ filter: { projectId: { eq: projectId } } }).subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

/** One task the user can read, or null. */
export async function getTask(taskId: string): Promise<Task | null> {
  const { data, errors } = await client.models.Task.get({ id: taskId });
  if (errors?.length) throw ApiError.from(errors, "Task load failed");
  return data ?? null;
}

/** One task with the ids of the tasks it depends on (to edit it without changing its links). */
export async function getTaskForEdit(taskId: string): Promise<{ task: Task; dependsOn: string[] }> {
  const { data: task, errors } = await client.models.Task.get({ id: taskId });
  if (errors?.length || !task) throw ApiError.from(errors, "This task no longer exists.");
  const dependsOn: string[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Dependency.list({ filter: { fromTaskId: { eq: taskId } }, nextToken });
    if (page.errors?.length) throw ApiError.from(page.errors, "Dependency load failed");
    dependsOn.push(...page.data.map((d) => d.toTaskId));
    nextToken = page.nextToken;
  } while (nextToken);
  return { task, dependsOn };
}

/** The editable fields of a stored task, as TaskInput. */
export function taskToInput(task: Task): TaskInput {
  return {
    projectId: task.projectId,
    title: task.title,
    description: task.description ?? undefined,
    priority: task.priority ?? "MEDIUM",
    dueDate: task.dueDate ?? undefined,
    estimatedHours: task.estimatedHours ?? undefined,
    requiredSkills: (task.requiredSkills ?? []).filter((s): s is string => !!s),
    assigneeId: task.assigneeId ?? undefined,
    parentTaskId: task.parentTaskId ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes (server-side rules + audit)                                          */
/* -------------------------------------------------------------------------- */

/** Creates a task and its dependency links (managers). Logged as CREATED by the server. */
export async function createTask(input: TaskInput, dependsOn: readonly string[] = [], status: "PROPOSED" | "TODO" = "TODO"): Promise<Task> {
  const result = await client.mutations.addTask({
    clientRequestId: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: emptyToNull(input.description),
    priority: input.priority,
    status,
    dueDate: emptyToNull(input.dueDate),
    estimatedHours: input.estimatedHours ?? null,
    requiredSkills: input.requiredSkills,
    assigneeId: emptyToNull(input.assigneeId),
    parentTaskId: emptyToNull(input.parentTaskId),
    dependsOn: [...dependsOn],
  });
  return unwrap(result, "Task creation failed");
}

/** Edits fields and replaces the dependency links (managers). Logged as UPDATED (+ ASSIGNED). */
export async function updateTask(task: Task, input: TaskInput, dependsOn: readonly string[]): Promise<Task> {
  const result = await client.mutations.editTask({
    clientRequestId: crypto.randomUUID(),
    taskId: task.id,
    title: input.title,
    description: emptyToNull(input.description),
    priority: input.priority,
    dueDate: emptyToNull(input.dueDate),
    estimatedHours: input.estimatedHours ?? null,
    requiredSkills: input.requiredSkills,
    assigneeId: emptyToNull(input.assigneeId),
    parentTaskId: emptyToNull(input.parentTaskId),
    dependsOn: [...dependsOn],
  });
  return unwrap(result, "Task update failed");
}

/** Kanban moves and blocker reports (`reason` is required for BLOCKED). Logged as STATUS_CHANGED. */
export async function changeTaskStatus(task: Task, status: TaskStatus, reason?: string): Promise<Task> {
  const result = await client.mutations.changeTaskStatus({
    clientRequestId: crypto.randomUUID(),
    taskId: task.id,
    status,
    reason: reason ?? null,
  });
  return unwrap(result, "Task status update failed");
}

/** Changes the assignee (managers). Logged as ASSIGNED. */
export async function assignTask(task: Task, assigneeId: string | null): Promise<Task> {
  const result = await client.mutations.assignTask({ clientRequestId: crypto.randomUUID(), taskId: task.id, assigneeId });
  return unwrap(result, "Task reassignment failed");
}

/** Cancels a task (managers): status CANCELLED, never deleted. Logged as STATUS_CHANGED. */
export async function cancelTask(task: Task, reason?: string): Promise<Task> {
  const result = await client.mutations.cancelTask({ clientRequestId: crypto.randomUUID(), taskId: task.id, reason: reason ?? null });
  return unwrap(result, "Task cancellation failed");
}
