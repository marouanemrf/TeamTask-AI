import { Link } from "react-router-dom";
import type { Task, TeamMember } from "../../services/client";
import { formatDate } from "../../utils/dates";
import { memberPath, projectPath } from "../../utils/routes";
import type { AssigneeOption } from "../../utils/taskRules";
import type { Workload } from "../../utils/workload";
import PriorityBadge from "../tasks/PriorityBadge";
import { ChevronDownIcon } from "../ui/Icons";
import MemberAvatar from "./MemberAvatar";
import PresenceDot from "./PresenceDot";
import ReassignControl from "./ReassignControl";
import WorkloadBar from "./WorkloadBar";

export interface WorkloadRowProps {
  member: TeamMember;
  workload: Workload;
  openTasks: Task[];
  overdueIds: ReadonlySet<string>;
  projectNames: ReadonlyMap<string, string>;
  expanded: boolean;
  onToggle: () => void;
  /** Task currently being reassigned (its picker is open). */
  reassigningId: string | null;
  onStartReassign: (task: Task) => void;
  onCancelReassign: () => void;
  reassignOptions: (task: Task) => AssigneeOption[];
  onReassign: (task: Task, assigneeId: string) => void;
  busy: boolean;
}

/** One member: load bar and counts; expands to their open tasks with "Reassign" where it helps. */
function WorkloadRow(props: WorkloadRowProps) {
  const { member, workload, openTasks, overdueIds, projectNames, expanded, onToggle, reassigningId, onStartReassign, onCancelReassign, reassignOptions, onReassign, busy } = props;
  const listId = `workload-tasks-${member.id}`;
  const overloaded = workload.percent > 100;

  return (
    <li className={`workload-row${expanded ? " workload-row--open" : ""}`}>
      <button type="button" className="workload-row__summary" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
        <span className="workload-row__who">
          <span className="avatar-presence"><MemberAvatar name={member.name} avatarKey={member.avatarKey} size="sm"/><PresenceDot email={member.email}/></span>
          <span className="workload-row__identity">
            <span className="workload-row__name">{member.name}</span>
            <span className="workload-row__job">{member.jobTitle || "No job title"}</span>
          </span>
        </span>
        <span className="workload-row__bar">
          <WorkloadBar workload={workload} />
        </span>
        <span className="workload-row__counts">
          <span>
            <strong>{openTasks.length}</strong> open
          </span>
          <span className={overdueIds.size ? "text-error" : undefined}>
            <strong>{overdueIds.size}</strong> overdue
          </span>
        </span>
        <ChevronDownIcon />
      </button>

      {expanded && (
        <div id={listId} className="workload-row__tasks">
          {openTasks.length === 0 ? (
            <p className="empty-state">No open tasks.</p>
          ) : (
            <ul className="item-list">
              {openTasks.map((task) => {
                const overdue = overdueIds.has(task.id);
                const canReassign = overdue || overloaded;
                return (
                  <li key={task.id} className="workload-task">
                    <div className="workload-task__line">
                      <span className="item-list__main">
                        <span className="item-list__title">{task.title}</span>
                        <span className="item-list__meta">
                          <Link className="item-list__meta-link" to={projectPath(task.projectId)}>
                            {projectNames.get(task.projectId) ?? "Unknown project"}
                          </Link>
                          {" · "}
                          {task.estimatedHours != null ? `${task.estimatedHours} h` : "No estimate"}
                        </span>
                      </span>
                      <PriorityBadge priority={task.priority} />
                      <span className={`item-list__date${overdue ? " item-list__date--overdue" : ""}`}>
                        {task.dueDate ? formatDate(task.dueDate) : "No due date"}
                        {overdue && <span className="visually-hidden"> (overdue)</span>}
                      </span>
                      {canReassign && reassigningId !== task.id && (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => onStartReassign(task)}
                          disabled={busy}
                          aria-label={`Reassign ${task.title}`}
                        >
                          Reassign
                        </button>
                      )}
                    </div>
                    {reassigningId === task.id && (
                      <ReassignControl
                        taskTitle={task.title}
                        options={reassignOptions(task)}
                        requiredSkillCount={(task.requiredSkills ?? []).filter(Boolean).length}
                        busy={busy}
                        onConfirm={(assigneeId) => onReassign(task, assigneeId)}
                        onCancel={onCancelReassign}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="workload-row__link">
            <Link className="text-link" to={memberPath(member.id)}>
              Open {member.name}'s profile
            </Link>
          </p>
        </div>
      )}
    </li>
  );
}

export default WorkloadRow;
