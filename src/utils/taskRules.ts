/**
 * Task business rules for the React app.
 *
 * The rules that decide what is allowed (dependencies, cycles, permissions, blocker reasons,
 * due-date warnings) live in amplify/functions/shared/rules.ts and are shared with the Lambda
 * functions, which enforce them server-side. Here they give instant feedback; the server has
 * the last word. This file adds UI-only helpers (assignee ranking, progress, history parsing).
 */
import type { Task, TaskEvent, TeamMember } from "../services/client";
import { canBeAssigned, canPerform } from "../../amplify/functions/shared/rules";
import type { Role } from "../../amplify/functions/shared/rules";
import { computeWorkload } from "./workload";
import { isUnavailable } from "../../amplify/functions/shared/planning";

export {
  BLOCK_REASON_MAX,
  BLOCK_REASON_MIN,
  blocksIds,
  canBeAssigned,
  checkStatusChange,
  dependsOnIds,
  descendantIds,
  dueDateWarning,
  isOpenTask,
  isOverdue,
  unfinishedDependencies,
  validateBlockReason,
  wouldCreateCycle,
} from "../../amplify/functions/shared/rules";
export type { MoveCheck } from "../../amplify/functions/shared/rules";

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

export interface StatusPermission {
  isManager: boolean;
  /** VIEWER (or no group): read only. */
  isViewer: boolean;
  /** TeamMember ids whose email matches the signed-in user. */
  myMemberIds: readonly string[];
}

/** Same matrix as the server: managers move any task; MEMBER only theirs; VIEWER nothing. */
export function canChangeStatus(task: Pick<Task, "assigneeId">, who: StatusPermission): boolean {
  const roles: Role[] = who.isManager ? ["PROJECT_MANAGER"] : who.isViewer ? ["VIEWER"] : ["MEMBER"];
  const isAssignee = !!task.assigneeId && who.myMemberIds.includes(task.assigneeId);
  return canPerform("changeStatus", roles, { isAssignee });
}

/* -------------------------------------------------------------------------- */
/* Assignee suggestions                                                        */
/* -------------------------------------------------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();

/** How many of the required skills the member has (case-insensitive). */
export function skillMatchCount(memberSkills: ReadonlyArray<string | null> | null | undefined, required: readonly string[]): number {
  const have = new Set((memberSkills ?? []).filter((s): s is string => !!s).map(norm));
  return required.filter((s) => have.has(norm(s))).length;
}

export interface AssigneeOption {
  member: TeamMember;
  matches: number;
  /** Current workload % (open tasks / weekly capacity). */
  workloadPercent: number;
  /** Workload % if this task were assigned to them. */
  projectedPercent: number;
}

/**
 * Members ranked for a task: most matching skills first, then lowest current workload, then name.
 * `excludeTaskId` keeps the task being edited out of the member's current load.
 */
export function rankAssignees(
  members: readonly TeamMember[],
  allTasks: readonly Task[],
  requiredSkills: readonly string[],
  taskHours: number,
  excludeTaskId?: string,
  dueDate?: string | null,
): AssigneeOption[] {
  const now = new Date();
  const date = dueDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return members
    .filter((member) => {
      if (!canBeAssigned(member)) return false; // VIEWER is read-only: never offered as an assignee
      // Same rule as the planner: away on the due date (or today) = not offered.
      return !isUnavailable(member, date);
    })
    .map((member) => {
      const theirTasks = allTasks.filter((t) => t.assigneeId === member.id && t.id !== excludeTaskId);
      const current = computeWorkload(theirTasks, member.weeklyCapacityHours);
      const capacity = member.weeklyCapacityHours ?? 0;
      const projectedPercent = capacity > 0 ? Math.round(((current.hours + taskHours) / capacity) * 100) : 0;
      return {
        member,
        matches: skillMatchCount(member.skills, requiredSkills),
        workloadPercent: current.percent,
        projectedPercent,
      };
    })
    .sort(
      (a, b) =>
        b.matches - a.matches || a.workloadPercent - b.workloadPercent || a.member.name.localeCompare(b.member.name),
    );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/** DONE tasks / all tasks except CANCELLED, as a whole percentage. */
export function projectProgress(tasks: readonly Task[]): { done: number; total: number; percent: number } {
  const counted = tasks.filter((t) => t.status !== "CANCELLED");
  const done = counted.filter((t) => t.status === "DONE").length;
  return { done, total: counted.length, percent: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

/* -------------------------------------------------------------------------- */
/* Status history: blockers & completion time                                  */
/* -------------------------------------------------------------------------- */

/** TaskEvent before/after are AWSJSON strings; returns the parsed object or null. */
export function parseEventJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Latest STATUS_CHANGED event per task id. */
export function latestStatusEvents(events: readonly TaskEvent[]): Map<string, TaskEvent> {
  const latest = new Map<string, TaskEvent>();
  for (const event of events) {
    if (event.eventType !== "STATUS_CHANGED") continue;
    const current = latest.get(event.entityId);
    if (!current || event.createdAt > current.createdAt) latest.set(event.entityId, event);
  }
  return latest;
}

export interface BlockReason {
  reason: string;
  by: string | null;
  at: string;
}

/**
 * The blocker reported for a task: only while the task is still BLOCKED and its latest status
 * change was the "report a blocker" one (it carries `reason` in `after`).
 */
export function blockReasonFor(task: Pick<Task, "status">, latest: TaskEvent | undefined): BlockReason | undefined {
  if (task.status !== "BLOCKED" || !latest) return undefined;
  const after = parseEventJson(latest.after);
  if (after?.status !== "BLOCKED" || typeof after.reason !== "string" || !after.reason) return undefined;
  return { reason: after.reason, by: latest.actorEmail ?? null, at: latest.createdAt };
}

/** When a DONE task was completed: time of its latest status change to DONE (falls back to updatedAt). */
export function completedAt(task: Pick<Task, "status" | "updatedAt">, latest: TaskEvent | undefined): string | undefined {
  if (task.status !== "DONE") return undefined;
  const after = parseEventJson(latest?.after);
  return after?.status === "DONE" && latest ? latest.createdAt : task.updatedAt;
}
