import { useId } from "react";
import { Link } from "react-router-dom";
import type { Task, TaskStatus } from "../../services/client";
import { formatDate } from "../../utils/dates";
import { TASK_STATUS_LABELS } from "../../utils/projectLabels";
import { projectPath } from "../../utils/routes";
import type { BlockReason } from "../../utils/taskRules";
import { FlagIcon } from "../ui/Icons";
import BlockReasonNote from "./BlockReasonNote";
import PriorityBadge from "./PriorityBadge";

/** Statuses offered in the row's select (CANCELLED is a manager action). */
const ROW_STATUSES: readonly TaskStatus[] = ["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE"];

export interface MyTaskRowProps {
  task: Task;
  projectName: string;
  overdue: boolean;
  block?: BlockReason;
  canChange: boolean;
  busy: boolean;
  onStatusChange: (status: TaskStatus) => void;
  onReportBlocker: () => void;
  onOpen: () => void;
}

/** One of "my" tasks: title (opens details), project link, priority, due date, status select, blocker. */
function MyTaskRow({ task, projectName, overdue, block, canChange, busy, onStatusChange, onReportBlocker, onOpen }: MyTaskRowProps) {
  const id = useId();
  const status = task.status ?? "TODO";
  return (
    <li className={`my-task${overdue ? " my-task--overdue" : ""}`}>
      <div className="my-task__main">
        <button type="button" className="link-button my-task__title" onClick={onOpen}>
          {task.title}
        </button>
        <div className="my-task__meta">
          <Link className="my-task__project" to={projectPath(task.projectId)}>
            {projectName}
          </Link>
          <PriorityBadge priority={task.priority} />
          <span className={`my-task__due${overdue ? " text-error" : ""}`}>
            {task.dueDate ? `Due ${formatDate(task.dueDate)}` : "No due date"}
            {overdue && <span className="visually-hidden"> (overdue)</span>}
          </span>
        </div>
        {block && <BlockReasonNote block={block} />}
      </div>

      <div className="my-task__actions">
        <label className="visually-hidden" htmlFor={`${id}-status`}>
          Status of {task.title}
        </label>
        <select
          id={`${id}-status`}
          className="form-input my-task__status"
          value={status}
          disabled={!canChange || busy || status === "CANCELLED"}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
        >
          {ROW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
          {status === "CANCELLED" && <option value="CANCELLED">{TASK_STATUS_LABELS.CANCELLED}</option>}
        </select>
        {canChange && status !== "DONE" && status !== "CANCELLED" && (
          <button type="button" className="button-secondary my-task__block" onClick={onReportBlocker} disabled={busy}>
            <FlagIcon />
            <span>{status === "BLOCKED" ? "Update blocker" : "Report a blocker"}</span>
          </button>
        )}
      </div>
    </li>
  );
}

export default MyTaskRow;
