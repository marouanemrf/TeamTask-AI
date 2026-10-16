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
