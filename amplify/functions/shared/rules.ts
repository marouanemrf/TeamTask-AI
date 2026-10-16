/**
 * Task business rules — pure functions shared by the Lambda functions (source of truth) and the
 * React app (instant feedback, via src/utils/taskRules.ts). No AWS, React or Amplify imports here:
 * structural types only, so both sides can use their own generated model types.
 *
 * Dependency direction: { fromTaskId, toTaskId } means "fromTask depends on toTask".
 */

export const TASK_STATUSES = ["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  PROPOSED: "Proposed",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export interface TaskLike {
  id: string;
  title: string;
  status?: TaskStatusValue | null;
  dueDate?: string | null;
  assigneeId?: string | null;
  parentTaskId?: string | null;
}

export interface DependencyLike {
  fromTaskId: string;
  toTaskId: string;
}

/* -------------------------------------------------------------------------- */
/* Status & overdue                                                            */
/* -------------------------------------------------------------------------- */

/** Open = any status except DONE or CANCELLED. */
export function isOpenTask(task: Pick<TaskLike, "status">): boolean {
  return task.status !== "DONE" && task.status !== "CANCELLED";
}

/** Due date before today (YYYY-MM-DD) and still open. */
export function isOverdue(task: Pick<TaskLike, "status" | "dueDate">, today: string): boolean {
  return !!task.dueDate && task.dueDate < today && isOpenTask(task);
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

/** A dependency is satisfied when its task is DONE (or CANCELLED: it will never block again). */
function isSatisfied(task: TaskLike | undefined): boolean {
  return !task || task.status === "DONE" || task.status === "CANCELLED";
}

export function dependsOnIds(taskId: string, dependencies: readonly DependencyLike[]): string[] {
  return dependencies.filter((d) => d.fromTaskId === taskId).map((d) => d.toTaskId);
}

export function blocksIds(taskId: string, dependencies: readonly DependencyLike[]): string[] {
  return dependencies.filter((d) => d.toTaskId === taskId).map((d) => d.fromTaskId);
}

/** Tasks that `taskId` depends on and that are not finished yet. */
export function unfinishedDependencies<T extends TaskLike>(
  taskId: string,
  dependencies: readonly DependencyLike[],
  tasksById: ReadonlyMap<string, T>,
): T[] {
  return dependsOnIds(taskId, dependencies)
    .map((id) => tasksById.get(id))
    .filter((t): t is T => !!t && !isSatisfied(t));
}

/** Statuses that require every dependency to be finished first. */
const GATED: ReadonlySet<TaskStatusValue> = new Set(["IN_PROGRESS", "DONE"]);

export type MoveCheck = { ok: true } | { ok: false; reason: string; blocking: string[] };

/** Can `task` move to `target` given its dependencies? The reason names the blocking tasks. */
export function checkStatusChange(
  task: TaskLike,
  target: TaskStatusValue,
  dependencies: readonly DependencyLike[],
  tasksById: ReadonlyMap<string, TaskLike>,
  statusLabel: (s: TaskStatusValue) => string = (s) => STATUS_LABELS[s],
): MoveCheck {
  if (!GATED.has(target)) return { ok: true };
  const blocking = unfinishedDependencies(task.id, dependencies, tasksById);
  if (blocking.length === 0) return { ok: true };
  const names = blocking.map((t) => `“${t.title}”`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    ok: false,
    blocking: blocking.map((t) => t.id),
    reason: `“${task.title}” can't move to ${statusLabel(target)}: it depends on ${list}, which ${
      blocking.length === 1 ? "isn't done yet" : "aren't done yet"
    }.` ,
  };
}

/**
 * Would making `taskId` depend on every id in `dependsOn` create a cycle?
 * True if one of them is `taskId` itself or (transitively) already depends on `taskId`.
 * The task's own current dependencies are ignored: they are being replaced.
 */
export function wouldCreateCycle(taskId: string, dependsOn: readonly string[], dependencies: readonly DependencyLike[]): boolean {
  const edges = new Map<string, string[]>();
  for (const d of dependencies) {
    if (d.fromTaskId === taskId) continue;
    edges.set(d.fromTaskId, [...(edges.get(d.fromTaskId) ?? []), d.toTaskId]);
  }
  const stack = [...dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return false;
}

/** Ids of every subtask below `taskId` (children, grandchildren…). */
export function descendantIds(taskId: string, tasks: readonly Pick<TaskLike, "id" | "parentTaskId">[]): Set<string> {
  const result = new Set<string>();
  const stack = [taskId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const t of tasks) {
      if (t.parentTaskId === id && !result.has(t.id)) {
        result.add(t.id);
        stack.push(t.id);
      }
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Roles & permissions                                                         */
/* -------------------------------------------------------------------------- */

export const ROLES = ["ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** Known roles from Cognito groups. No known group = VIEWER. */
export function toRoles(groups: readonly string[] | null | undefined): Role[] {
  const roles = (groups ?? []).filter((g): g is Role => (ROLES as readonly string[]).includes(g));
  return roles.length > 0 ? roles : ["VIEWER"];
}

/** ADMIN or PROJECT_MANAGER. */
export function isManagerRole(roles: readonly Role[]): boolean {
  return roles.includes("ADMIN") || roles.includes("PROJECT_MANAGER");
}

/**
 * Can this team member be given tasks? Every task needs an assignee who can work on it: ADMIN,
 * PROJECT_MANAGER or MEMBER. VIEWER is read-only (see canPerform), so it can't hold a task.
 */
export function canBeAssigned(member: { role?: string | null; roles?: readonly (string | null)[] | null }): boolean {
  const roles = [...(member.roles ?? []), member.role];
  return roles.some((r) => r === "ADMIN" || r === "PROJECT_MANAGER" || r === "MEMBER");
}

export type TaskAction = "create" | "update" | "assign" | "cancel" | "changeStatus";

/**
 * Permission matrix:
 * - VIEWER (or no group): nothing.
 * - ADMIN / PROJECT_MANAGER: everything.
 * - MEMBER: only changeStatus, and only on tasks assigned to them (`isAssignee`).
 */
export function canPerform(action: TaskAction, roles: readonly Role[], ctx: { isAssignee?: boolean } = {}): boolean {
  if (isManagerRole(roles)) return true;
  if (roles.includes("MEMBER")) return action === "changeStatus" && ctx.isAssignee === true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export const BLOCK_REASON_MIN = 10;
export const BLOCK_REASON_MAX = 500;

export function validateBlockReason(text: string | null | undefined): string | undefined {
  const reason = (text ?? "").trim();
  if (reason.length < BLOCK_REASON_MIN) return `Describe the blocker in at least ${BLOCK_REASON_MIN} characters.`;
  if (reason.length > BLOCK_REASON_MAX) return `The blocker description must be at most ${BLOCK_REASON_MAX} characters.`;
  return undefined;
}

/** Warning when a due date falls outside the project's dates (never blocking). */
export function dueDateWarning(
  dueDate: string | null | undefined,
  projectStart: string | null | undefined,
  projectEnd: string | null | undefined,
): string | undefined {
  if (!dueDate) return undefined;
  if (projectStart && dueDate < projectStart) return "This due date is before the project starts.";
  if (projectEnd && dueDate > projectEnd) return "This due date is after the project ends.";
  return undefined;
}
