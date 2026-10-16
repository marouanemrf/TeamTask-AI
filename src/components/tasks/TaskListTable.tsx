import type { Dependency, Task, TeamMember } from "../../services/client";
import { formatDate } from "../../utils/dates";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "../../utils/projectLabels";
import { isOverdue, unfinishedDependencies } from "../../utils/taskRules";
import { LockIcon } from "../ui/Icons";
import PriorityBadge from "./PriorityBadge";

export interface TaskListTableProps {
  tasks: Task[];
  dependencies: readonly Dependency[];
  tasksById: ReadonlyMap<string, Task>;
  membersById: ReadonlyMap<string, TeamMember>;
  today: string;
  onOpen: (task: Task) => void;
}

/** All tasks (cancelled included), by status then due date. The title is the keyboard target. */
function TaskListTable({ tasks, dependencies, tasksById, membersById, today, onOpen }: TaskListTableProps) {
  if (tasks.length === 0) return <p className="empty-state panel">No tasks yet.</p>;

  const order = (t: Task) => TASK_STATUS_ORDER.indexOf(t.status ?? "TODO");
  const sorted = [...tasks].sort(
    (a, b) => order(a) - order(b) || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"),
  );

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Due date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => {
            const blocked = unfinishedDependencies(task.id, dependencies, tasksById).length;
            const overdue = isOverdue(task, today);
            const status = task.status ?? "TODO";
            return (
              <tr key={task.id} className={`data-table__row${status === "CANCELLED" ? " data-table__row--muted" : ""}`} onClick={() => onOpen(task)}>
                <td>
                  <button
                    type="button"
                    className="link-button data-table__link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(task);
                    }}
                  >
                    {task.title}
                  </button>
                  {blocked > 0 && (
                    <span className="task-card__lock" title={`Waiting for ${blocked} unfinished dependencies`}>
                      <LockIcon />
                      <span className="visually-hidden">Blocked by {blocked} unfinished dependencies</span>
                    </span>
                  )}
                </td>
                <td>
                  <span className={`status-text status-text--${status.toLowerCase()}`}>{TASK_STATUS_LABELS[status]}</span>
                </td>
                <td>
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="text-muted">{task.assigneeId ? (membersById.get(task.assigneeId)?.name ?? "—") : "Unassigned"}</td>
                <td className={`nowrap${overdue ? " text-error" : ""}`}>
                  {formatDate(task.dueDate)}
                  {overdue && <span className="visually-hidden"> (overdue)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TaskListTable;
