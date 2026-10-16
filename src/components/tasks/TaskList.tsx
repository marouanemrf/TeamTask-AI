import type { Task } from "../../services/client";
import { formatDate } from "../../utils/dates";
import { TASK_STATUS_LABELS } from "../../utils/projectLabels";

export interface TaskListProps {
  tasks: Task[];
  projectNames: ReadonlyMap<string, string>;
  /** YYYY-MM-DD, used to flag overdue due dates. */
  today: string;
  emptyMessage: string;
}

function TaskList({ tasks, projectNames, today, emptyMessage }: TaskListProps) {
  if (tasks.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ul className="item-list">
      {tasks.map((task) => {
        const overdue = !!task.dueDate && task.dueDate < today;
        return (
          <li key={task.id} className="item-list__item">
            <span className="item-list__main">
              <span className="item-list__title">{task.title}</span>
              <span className="item-list__meta">
                {projectNames.get(task.projectId) ?? "Unknown project"}
                {task.status && ` · ${TASK_STATUS_LABELS[task.status]}`}
              </span>
            </span>
            <span className={`item-list__date${overdue ? " item-list__date--overdue" : ""}`}>
              {task.dueDate ? formatDate(task.dueDate) : "No due date"}
              {overdue && <span className="visually-hidden"> (overdue)</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default TaskList;
