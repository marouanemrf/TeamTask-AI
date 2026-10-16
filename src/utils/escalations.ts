import type { Escalation, Task } from "../services/client";
import { isOpenTask } from "./taskStatus";

/**
 * Escalations that still need a manager's decision: status OPEN (created by the daily
 * deadline check for tasks overdue by 2+ days, closed only by a manager's decision) and whose
 * task still exists and is still open. An escalation left OPEN on a task that has since been
 * done or cancelled no longer needs attention, so it is not counted.
 */
export function activeEscalations<E extends Pick<Escalation, "status" | "taskId">>(escalations: readonly E[], tasksById: ReadonlyMap<string, Pick<Task, "status">>): E[] {
  return escalations.filter((e) => {
    if (e.status !== "OPEN") return false;
    const task = tasksById.get(e.taskId);
    return !!task && isOpenTask(task);
  });
}
