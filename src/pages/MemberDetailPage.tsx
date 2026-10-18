import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CvBuilder from "../components/team/CvBuilder";
import MemberAvatar from "../components/team/MemberAvatar";
import MemberFormModal from "../components/team/MemberFormModal";
import SkillChips from "../components/team/SkillChips";
import WorkloadBar from "../components/team/WorkloadBar";
import PresenceDot from "../components/team/PresenceDot";
import { useCareerSuggestions } from "../hooks/useCareerSuggestions";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useMemberActions, useTeamMembers } from "../hooks/useTeam";
import { useTeamGroups } from "../hooks/useTeamGroups";
import { useUser } from "../hooks/useUser";
import type { Task } from "../services/client";
import type { AvatarChange, MemberInput } from "../services/teamService";
import { formatDate, todayIsoDate } from "../utils/dates";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "../utils/projectLabels";
import { canUseAssistant } from "../utils/roles";
import type { Role } from "../utils/roles";
import { ROUTES, projectPath } from "../utils/routes";
import { isOpenTask, isOverdue } from "../utils/taskStats";
import { computeWorkload } from "../utils/workload";
import LoadingState from "../components/ui/LoadingState";

function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isManager, email: myEmail } = useUser();
  const { members, loading } = useTeamMembers();
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects } = useProjects();
  const { update, remove, submitting, error, clearError } = useMemberActions();
  const teamGroups = useTeamGroups();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const member = members.find((m) => m.id === id);
  const today = todayIsoDate();

  const memberTasks = useMemo(() => tasks.filter((t) => t.assigneeId === id), [tasks, id]);
  const openTasks = memberTasks.filter(isOpenTask);
  const workload = computeWorkload(memberTasks, member?.weeklyCapacityHours);
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  // Projects the member works on (has tasks in), for the CV.
  const memberProjects = useMemo(() => {
    const ids = new Set(memberTasks.map((t) => t.projectId));
    return projects.filter((p) => ids.has(p.id));
  }, [memberTasks, projects]);
  // Managers see the member's CV and AI career ideas; CVs start at Member (not for viewers).
  const memberRoles = (member?.roles?.length ? member.roles : [member?.role ?? "VIEWER"]).filter((r): r is Role => !!r);
  const showCv = isManager && !!member && canUseAssistant(memberRoles);
  const career = useCareerSuggestions(showCv ? member : undefined);

  // Tasks grouped by status, active work first; each group sorted by due date.
  const groups = useMemo(() => {
    const byStatus = new Map<string, Task[]>();
    for (const task of memberTasks) {
      const key = task.status ?? "TODO";
      byStatus.set(key, [...(byStatus.get(key) ?? []), task]);
    }
    return TASK_STATUS_ORDER.filter((s) => byStatus.has(s)).map((status) => ({
      status,
      tasks: (byStatus.get(status) ?? []).sort((a, b) =>
        (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"),
      ),
    }));
  }, [memberTasks]);

  if (loading) return <LoadingState className="empty-state panel">Loading member…</LoadingState>;

  if (!member) {
    return (
      <div className="panel">
        <p>Member not found.</p>
        <p className="panel__footer">
          <Link className="text-link" to={ROUTES.team}>
            Back to team
          </Link>
        </p>
      </div>
    );
  }
  const isSelf = !!myEmail && member.email.toLowerCase() === myEmail.toLowerCase();

  async function handleUpdate(input: MemberInput, avatar: AvatarChange) {
    return member ? (await update(member, input, avatar)) !== null : false;
  }

  async function handleDelete() {
    if (!member || openTasks.length > 0) return;
    if (await remove(member)) navigate(ROUTES.team);
  }

  const deleteBlocked = !tasksLoading && openTasks.length > 0;

  return (
    <div className="page-stack">
      {/* Profile header */}
      <section className="panel member-header">
        <span className="avatar-presence avatar-presence--large"><MemberAvatar name={member.name} avatarKey={member.avatarKey} size="lg"/><PresenceDot email={member.email} focusable /></span>
        <div className="member-header__identity">
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
  <h2 className="member-header__name">{member.name}</h2>
  <span style={{ fontSize: "12px", color: "#888", fontWeight: 400 }}>
    {member.role}
  </span>
</div>
          {member.username && <p className="member-header__username">@{member.username}</p>}
          <p className="text-muted">{member.jobTitle || "No job title"}</p>
          <p className="member-header__email">{member.email}</p>
          {member.teamId && <p className="text-muted">Team: {teamGroups.teams.find((t) => t.id === member.teamId)?.name ?? "—"}</p>}
          {(member.unavailableFrom || member.unavailableUntil) && (
            <p className="form-hint">Planned absence: {member.unavailableFrom ? formatDate(member.unavailableFrom) : "…"} – {member.unavailableUntil ? formatDate(member.unavailableUntil) : "…"}</p>
          )}
        </div>
        
        {/* Use case "Manage accounts": administrators only (checked again on the server); nobody deletes themselves. */}
        {isAdmin && (
          <div className="member-header__actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                clearError();
                setEditing(true);
              }}
            >
              Edit
            </button>
            {!isSelf && (
              <button
                type="button"
                className="button-danger"
                onClick={() => {
                  clearError();
                  setConfirmingDelete(true);
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </section>

      {/* Delete confirmation / blocking explanation */}
      {confirmingDelete &&
        (deleteBlocked ? (
          <div className="form-alert" role="alert">
            <span>
              {member.name} can't be deleted because they still have {openTasks.length} open task
              {openTasks.length === 1 ? "" : "s"}. Reassign, complete or cancel those tasks first.
            </span>
            <button type="button" className="button-secondary alert__action" onClick={() => setConfirmingDelete(false)}>
              OK
            </button>
          </div>
        ) : (
          <div className="panel confirm" role="alertdialog" aria-labelledby="confirm-delete-title">
            <p id="confirm-delete-title">
              Delete <strong>{member.name}</strong>? This removes their profile; it cannot be undone.
            </p>
            {error && (
              <div className="form-alert" role="alert">
                <span>{error}</span>
              </div>
            )}
            <div className="confirm__actions">
              <button type="button" className="button-secondary" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="button-danger" onClick={() => void handleDelete()} disabled={submitting || tasksLoading}>
                {submitting ? "Deleting…" : "Delete member"}
              </button>
            </div>
          </div>
        ))}

      <div className="two-columns">
        {/* Skills & capacity */}
        <section className="panel" aria-labelledby="skills-title">
          <h2 id="skills-title" className="panel__title">
            Skills
          </h2>
          <SkillChips skills={member.skills ?? []} />
          <h2 className="panel__title panel__title--spaced">Weekly workload</h2>
          {tasksLoading ? <LoadingState /> : <WorkloadBar workload={workload} />}
          <p className="form-hint">Sum of estimated hours of open tasks vs. weekly capacity ({member.weeklyCapacityHours ?? 0} h).</p>
        </section>

        {/* Assigned tasks */}
        <section className="panel" aria-labelledby="tasks-title">
          <h2 id="tasks-title" className="panel__title">
            Assigned tasks ({memberTasks.length})
          </h2>
          {tasksLoading ? (
            <LoadingState />
          ) : groups.length === 0 ? (
            <p className="empty-state">No tasks assigned.</p>
          ) : (
            groups.map((group) => (
              <div key={group.status} className="task-group">
                <h3 className="task-group__title">
                  {TASK_STATUS_LABELS[group.status]} <span className="text-muted">({group.tasks.length})</span>
                </h3>
                <ul className="item-list">
                  {group.tasks.map((task) => {
                    const overdue = isOverdue(task, today);
                    return (
                      <li key={task.id} className="item-list__item">
                        <span className="item-list__main">
                          <span className="item-list__title">{task.title}</span>
                          <Link className="item-list__meta item-list__meta-link" to={projectPath(task.projectId)}>
                            {projectNames.get(task.projectId) ?? "Unknown project"}
                          </Link>
                        </span>
                        <span className={`item-list__date${overdue ? " item-list__date--overdue" : ""}`}>
                          {task.dueDate ? formatDate(task.dueDate) : "No due date"}
                          {overdue && <span className="visually-hidden"> (overdue)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>

      {showCv && member && (
        <CvBuilder member={member} email={member.email} projects={memberProjects} career={career.state} onRefreshCareer={career.refresh} ownProfile={false} />
      )}

      <p>
        <Link className="text-link" to={ROUTES.team}>
          ← Back to team
        </Link>
      </p>

      {editing && (
        <MemberFormModal
          member={member}
          teams={teamGroups.teams}
          existingEmails={members.map((m) => m.email)}
          existingUsernames={members.flatMap((m) => (m.username ? [m.username] : []))}
          submitting={submitting}
          error={error}
          onSubmit={handleUpdate}
          onClose={() => setEditing(false)}
          canGrantPrivileged={isAdmin}
          lockAdminRole={isAdmin && isSelf}
        />
      )}
    </div>
  );
}

export default MemberDetailPage;
