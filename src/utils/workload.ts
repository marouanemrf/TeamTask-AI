import type { Task } from "../services/client";
import { isOpenTask } from "./taskStatus";

export type WorkloadLevel = "ok" | "high" | "over";

export interface Workload {
  /** Sum of estimatedHours of the member's open tasks. */
  hours: number;
  capacity: number;
  /** hours / capacity × 100, rounded. 0 when capacity is missing. */
  percent: number;
  /** ok < 80%, high 80–100%, over > 100%. */
  level: WorkloadLevel;
}

export function workloadLevel(percent: number): WorkloadLevel {
  if (percent > 100) return "over";
  if (percent >= 80) return "high";
  return "ok";
}

/** Weekly workload from the member's assigned tasks (closed tasks and missing estimates count as 0). */
export function computeWorkload(tasks: readonly Task[], weeklyCapacityHours: number | null | undefined): Workload {
  const hours = tasks.filter(isOpenTask).reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  const capacity = weeklyCapacityHours ?? 0;
  const percent = capacity > 0 ? Math.round((hours / capacity) * 100) : 0;
  return { hours, capacity, percent, level: workloadLevel(percent) };
}

export interface MemberLoadRow {
  workload: Workload;
}

export interface WorkloadSummary {
  /** Open tasks (not done, not cancelled) in scope. */
  openTasks: number;
  /** Open tasks with no assignee (legacy data; new tasks always have one). */
  unassigned: number;
  overdue: number;
  blocked: number;
  /** Members above 100 % of their weekly capacity. */
  overloaded: number;
  /** Mean load of the members who have a capacity. */
  average: number;
  /** Open tasks without an estimate: they count 0 hours in the load. */
  withoutEstimate: number;
}

/** Team-level figures for the workload page, from the tasks in scope and the per-member rows. */
export function summariseWorkload(rows: readonly MemberLoadRow[], tasks: readonly Task[], today: string): WorkloadSummary {
  const open = tasks.filter(isOpenTask);
  const withCapacity = rows.filter((r) => r.workload.capacity > 0);
  return {
    openTasks: open.length,
    unassigned: open.filter((t) => !t.assigneeId).length,
    overdue: open.filter((t) => !!t.dueDate && t.dueDate < today).length,
    blocked: open.filter((t) => t.status === "BLOCKED").length,
    overloaded: rows.filter((r) => r.workload.percent > 100).length,
    average: withCapacity.length ? Math.round(withCapacity.reduce((sum, r) => sum + r.workload.percent, 0) / withCapacity.length) : 0,
    withoutEstimate: open.filter((t) => t.estimatedHours == null).length,
  };
}
