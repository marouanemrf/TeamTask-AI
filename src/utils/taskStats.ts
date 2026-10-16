import type { Task } from "../services/client";
import { isOpenTask, isOverdue } from "./taskRules";

// The rules live in taskRules.ts; re-exported here for existing callers.
export { isOpenTask, isOverdue };

/** Share of DONE tasks, as a whole percentage (0 when there are no tasks). */
export function completionPercent(tasks: readonly Task[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === "DONE").length;
  return Math.round((done / tasks.length) * 100);
}

/** Tasks grouped by project id. */
export function groupTasksByProject(tasks: readonly Task[]): Map<string, Task[]> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = groups.get(task.projectId);
    if (list) list.push(task);
    else groups.set(task.projectId, [task]);
  }
  return groups;
}

/** Open tasks sorted by due date (tasks without a due date last). */
export function upcomingTasks(tasks: readonly Task[], limit: number): Task[] {
  return tasks
    .filter(isOpenTask)
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))
    .slice(0, limit);
}
