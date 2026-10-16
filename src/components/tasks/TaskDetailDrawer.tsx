import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Dependency, Task, TaskEvent, TaskStatus, TeamMember } from "../../services/client";
import { useTaskHistory } from "../../hooks/useTasks";
import { formatDate, formatDateTime } from "../../utils/dates";
import { projectPath } from "../../utils/routes";
import { PRIORITY_LABELS, TASK_EVENT_LABELS, TASK_STATUS_LABELS } from "../../utils/projectLabels";
import { blockReasonFor, blocksIds, dependsOnIds, isOverdue, latestStatusEvents, parseEventJson } from "../../utils/taskRules";
import SkillChips from "../team/SkillChips";
import Modal from "../ui/Modal";
import BlockReasonNote from "./BlockReasonNote";
import PriorityBadge from "./PriorityBadge";

/** Statuses offered in the drawer's status control (CANCELLED goes through "Cancel task"). */
const MOVE_TARGETS: readonly TaskStatus[] = ["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE"];

export interface TaskDetailDrawerProps {
  task: Task;
  /** Name of the project the task belongs to (shown with a link to it). */
  projectName: string;
  tasksById: ReadonlyMap<string, Task>;
  projectTasks: readonly Task[];
  dependencies: readonly Dependency[];
  membersById: ReadonlyMap<string, TeamMember>;
  today: string;
  canEdit: boolean;
  canMove: boolean;
  busy: boolean;
  error: string | null;
  onMove: (status: TaskStatus) => void;
  onEdit: () => void;
  onCancelTask: () => void;
  onOpenTask: (task: Task) => void;
  onClose: () => void;
}

/** Human summary of one audit event. */
function describeEvent(event: TaskEvent, membersById: ReadonlyMap<string, TeamMember>): string {
  const before = parseEventJson(event.before);
  const after = parseEventJson(event.after);
  const status = (v: unknown) => (typeof v === "string" && v in TASK_STATUS_LABELS ? TASK_STATUS_LABELS[v as TaskStatus] : "—");
  const person = (v: unknown) => (typeof v === "string" ? (membersById.get(v)?.name ?? "a removed member") : "Unassigned");
  switch (event.eventType) {
    case "STATUS_CHANGED":
      return `${status(before?.status)} → ${status(after?.status)}${typeof after?.reason === "string" ? ` — “${after.reason}”` : ""}`;
    case "ASSIGNED":
      return `${person(before?.assigneeId)} → ${person(after?.assigneeId)}`;
    case "CREATED":
      return "Task created";
    case "UPDATED":
      return "Title, dates, skills or dependencies edited";
    default:
      return event.eventType ? TASK_EVENT_LABELS[event.eventType] : "";
  }
}

function TaskLinks({ ids, tasksById, onOpenTask, empty }: { ids: string[]; tasksById: ReadonlyMap<string, Task>; onOpenTask: (t: Task) => void; empty: string }) {
  const tasks = ids.map((i) => tasksById.get(i)).filter((t): t is Task => !!t);
  if (tasks.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="link-list">
      {tasks.map((t) => (
        <li key={t.id}>
          <button type="button" className="link-button" onClick={() => onOpenTask(t)}>
            {t.title}
          </button>
          <span className={`status-text status-text--${(t.status ?? "TODO").toLowerCase()}`}>{TASK_STATUS_LABELS[t.status ?? "TODO"]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Side panel with every field, related tasks and the audit history of a task. */
function TaskDetailDrawer(props: TaskDetailDrawerProps) {
  const { task, projectName, tasksById, projectTasks, dependencies, membersById, today, canEdit, canMove, busy, error, onMove, onEdit, onCancelTask, onOpenTask, onClose } = props;
  const id = useId();
  const { events, loading: historyLoading } = useTaskHistory(task.id);
  const [target, setTarget] = useState<TaskStatus>(task.status ?? "TODO");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
  const parent = task.parentTaskId ? tasksById.get(task.parentTaskId) : undefined;
  const subtasks = projectTasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id);
  const cancelled = task.status === "CANCELLED";
  const overdue = isOverdue(task, today);
  // The blocker reason lives in the latest STATUS_CHANGED event of this task.
  const block = useMemo(() => blockReasonFor(task, latestStatusEvents(events).get(task.id)), [task, events]);

  return (
    <Modal title={task.title} variant="drawer" onClose={onClose} busy={busy}>
      <div className="drawer__badges">
        <span className={`status-text status-text--${(task.status ?? "TODO").toLowerCase()}`}>{TASK_STATUS_LABELS[task.status ?? "TODO"]}</span>
        <PriorityBadge priority={task.priority} />
        {task.createdBy === "AI" && <span className="chip chip--ai">AI</span>}
      </div>

      {block && <BlockReasonNote block={block} />}

      {error && (
        <div className="form-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      {!cancelled && (canMove || canEdit) && (
        <div className="drawer__actions">
          {canMove && (
            <div className="drawer__move">
              <label className="visually-hidden" htmlFor={`${id}-status`}>
                New status
              </label>
              <select id={`${id}-status`} className="form-input" value={target} onChange={(e) => setTarget(e.target.value as TaskStatus)} disabled={busy}>
                {MOVE_TARGETS.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button type="button" className="button-secondary" onClick={() => onMove(target)} disabled={busy || target === task.status}>
                Change status
              </button>
            </div>
          )}
          {canEdit && (
            <div className="drawer__manage">
              <button type="button" className="button-secondary" onClick={onEdit} disabled={busy}>
                Edit
              </button>
              <button type="button" className="button-danger" onClick={() => setConfirmCancel(true)} disabled={busy}>
                Cancel task
              </button>
            </div>
          )}
        </div>
      )}
      {confirmCancel && !cancelled && (
        <div className="panel confirm" role="alertdialog" aria-labelledby={`${id}-cancel-title`}>
          <p id={`${id}-cancel-title`}>
            Cancel <strong>{task.title}</strong>? It stays in the history with status Cancelled.
          </p>
          <div className="confirm__actions">
            <button type="button" className="button-secondary" onClick={() => setConfirmCancel(false)} disabled={busy}>
              Keep task
            </button>
            <button type="button" className="button-danger" onClick={onCancelTask} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel task"}
            </button>
          </div>
        </div>
      )}

      {/* Fields */}
      <dl className="details">
        <dt>Project</dt>
        <dd><Link to={projectPath(task.projectId)}>{projectName}</Link></dd>
        <dt>Assigned to</dt>
        <dd>{assignee ? `${assignee.name}${assignee.username ? ` (@${assignee.username})` : ""}` : "Unassigned"}</dd>
        <dt>Priority</dt>
        <dd>{task.priority ? PRIORITY_LABELS[task.priority] : "—"}</dd>
        <dt>Due date</dt>
        <dd className={overdue ? "text-error" : undefined}>
          {formatDate(task.dueDate)}
          {overdue && " (overdue)"}
        </dd>
        <dt>Estimated hours</dt>
        <dd>{task.estimatedHours != null ? `${task.estimatedHours} h` : "—"}</dd>
        <dt>Parent task</dt>
        <dd>
          {parent ? (
            <button type="button" className="link-button" onClick={() => onOpenTask(parent)}>
              {parent.title}
            </button>
          ) : (
            "—"
          )}
        </dd>
        <dt>Created by</dt>
        <dd>{task.createdBy === "AI" ? "AI proposal" : "Team member"}</dd>
        <dt>Description</dt>
        <dd>{task.description || "—"}</dd>
      </dl>

      <h3 className="drawer__section">Required skills</h3>
      <SkillChips skills={task.requiredSkills ?? []} emptyLabel="None" />

      <h3 className="drawer__section">Subtasks</h3>
      <TaskLinks ids={subtasks} tasksById={tasksById} onOpenTask={onOpenTask} empty="No subtasks." />

      <h3 className="drawer__section">Depends on</h3>
      <TaskLinks ids={dependsOnIds(task.id, dependencies)} tasksById={tasksById} onOpenTask={onOpenTask} empty="No dependencies." />

      <h3 className="drawer__section">Blocks</h3>
      <TaskLinks ids={blocksIds(task.id, dependencies)} tasksById={tasksById} onOpenTask={onOpenTask} empty="No task depends on this one." />

      <h3 className="drawer__section">History</h3>
      {historyLoading ? (
        <p className="text-muted">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-muted">No history yet.</p>
      ) : (
        <ol className="history">
          {events.map((event) => (
            <li key={event.id} className="history__item">
              <p className="history__what">
                <strong>{event.eventType ? TASK_EVENT_LABELS[event.eventType] : "Event"}</strong> · {describeEvent(event, membersById)}
              </p>
              <p className="history__meta">
                {event.actorType === "SYSTEM" ? "System" : event.actorType === "AI" ? "AI" : (event.actorEmail ?? "Unknown user")} ·{" "}
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export default TaskDetailDrawer;
