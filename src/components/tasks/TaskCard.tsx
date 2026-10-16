import { useDraggable } from "@dnd-kit/core";
import type { KeyboardEvent } from "react";
import type { Task, TeamMember } from "../../services/client";
import { formatDate } from "../../utils/dates";
import type { BlockReason } from "../../utils/taskRules";
import MemberAvatar from "../team/MemberAvatar";
import PresenceDot from "../team/PresenceDot";
import { LockIcon } from "../ui/Icons";
import BlockReasonNote from "./BlockReasonNote";
import PriorityBadge from "./PriorityBadge";

export interface TaskCardViewProps {
  task: Task;
  assignee?: TeamMember;
  overdue: boolean;
  /** Number of dependencies that are not finished yet. */
  blockedBy: number;
  /** Reported blocker, while the task is Blocked. */
  block?: BlockReason;
}

/** Card content, shared by the board and the drag preview. */
export function TaskCardView({ task, assignee, overdue, blockedBy, block }: TaskCardViewProps) {
  return (
    <>
      <div className="task-card__top">
        <PriorityBadge priority={task.priority} />
        {task.createdBy === "AI" && (
          <span className="chip chip--ai" title="Proposed by AI">
            AI
          </span>
        )}
        {blockedBy > 0 && (
          <span className="task-card__lock" title={`Waiting for ${blockedBy} unfinished ${blockedBy === 1 ? "dependency" : "dependencies"}`}>
            <LockIcon />
            <span className="visually-hidden">
              Blocked by {blockedBy} unfinished {blockedBy === 1 ? "dependency" : "dependencies"}
            </span>
          </span>
        )}
      </div>
      <p className="task-card__title">{task.title}</p>
      {block && <BlockReasonNote block={block} compact />}
      <div className="task-card__bottom">
        {assignee ? (
          <span className="task-card__assignee" title={assignee.name}>
            <span className="avatar-presence"><MemberAvatar name={assignee.name} avatarKey={assignee.avatarKey} size="sm"/><PresenceDot email={assignee.email}/></span>
            <span className="visually-hidden">Assigned to {assignee.name}</span>
          </span>
        ) : (
          <span className="task-card__unassigned">Unassigned</span>
        )}
        {task.dueDate && (
          <span className={`task-card__due${overdue ? " task-card__due--overdue" : ""}`}>
            {formatDate(task.dueDate)}
            {overdue && <span className="visually-hidden"> (overdue)</span>}
          </span>
        )}
      </div>
    </>
  );
}

export interface TaskCardProps extends TaskCardViewProps {
  /** False when the user may not change this task's status (card stays clickable). */
  movable: boolean;
  onOpen: (task: Task) => void;
}

/** Draggable card. Click or Enter opens the task; Space picks it up (when movable). */
function TaskCard({ movable, onOpen, ...view }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: view.task.id,
    disabled: !movable,
    data: { task: view.task },
  });

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    listeners?.onKeyDown?.(event);
    // Enter opens the task — unless it is ending a keyboard drag.
    if (event.key === "Enter" && !isDragging) onOpen(view.task);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      // dnd-kit marks non-draggable items aria-disabled, but the card still opens the task.
      aria-disabled={undefined}
      aria-roledescription={movable ? "draggable task" : "task"}
      className={`task-card${isDragging ? " task-card--dragging" : ""}${movable ? "" : " task-card--locked"}`}
      onClick={() => onOpen(view.task)}
      onKeyDown={handleKeyDown}
    >
      <TaskCardView {...view} />
    </div>
  );
}

export default TaskCard;
