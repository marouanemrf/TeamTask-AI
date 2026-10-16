import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import WorkloadRow from "../components/team/WorkloadRow";
import StatCard from "../components/ui/StatCard";
import { useProjects } from "../hooks/useProjects";
import { useTeamMembers } from "../hooks/useTeam";
import { useAllTasksBoard, useTaskActions } from "../hooks/useTasks";
import { useUser } from "../hooks/useUser";
import type { Task } from "../services/client";
import { todayIsoDate } from "../utils/dates";
import { ROUTES } from "../utils/routes";
import { isOpenTask, isOverdue, rankAssignees } from "../utils/taskRules";
import { computeWorkload, summariseWorkload } from "../utils/workload";

/** Team workload (managers): load per member, overdue counts, and reassignment of overdue / overloaded work. */
function WorkloadPage() {
  const id = useId();
  const { isManager } = useUser();
  const { members, loading: membersLoading } = useTeamMembers();
  const board = useAllTasksBoard();
  const actions = useTaskActions(board.patch);
  const { projects } = useProjects();
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const today = todayIsoDate();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const scoped = useMemo(
    () => board.tasks.filter((t) => projectFilter === "ALL" || t.projectId === projectFilter),
    [board.tasks, projectFilter],
  );

  // One row per member, heaviest load first.
  const rows = useMemo(
    () =>
      members
        .map((member) => {
          const theirs = scoped.filter((t) => t.assigneeId === member.id);
          const openTasks = theirs.filter(isOpenTask).sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
          return {
            member,
            workload: computeWorkload(theirs, member.weeklyCapacityHours),
            openTasks,
            overdueIds: new Set(openTasks.filter((t) => isOverdue(t, today)).map((t) => t.id)),
          };
        })
        .sort((a, b) => b.workload.percent - a.workload.percent || a.member.name.localeCompare(b.member.name)),
    [members, scoped, today],
  );

  const summary = useMemo(() => summariseWorkload(rows, scoped, today), [rows, scoped, today]);

  /** Other members, best skill match and lowest current load first (load counts every project). */
  const reassignOptions = (task: Task) =>
    rankAssignees(
      members.filter((m) => m.id !== task.assigneeId),
      board.tasks,
      (task.requiredSkills ?? []).filter((s): s is string => !!s),
      task.estimatedHours ?? 0,
      task.id,
    );

  async function handleReassign(task: Task, assigneeId: string) {
    setDone(null);
    if (await actions.reassign(task, assigneeId)) {
      setReassigningId(null);
      setDone(`“${task.title}” reassigned to ${members.find((m) => m.id === assigneeId)?.name ?? "the selected member"}.`);
    }
  }

  function toggle(memberId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  if (!isManager) {
    return (
      <div className="panel">
        <p>Team workload is available to administrators and project managers.</p>
        <p className="panel__footer">
          <Link className="text-link" to={ROUTES.myTasks}>
            Go to my tasks
          </Link>
        </p>
      </div>
    );
  }

  const loading = membersLoading || board.loading;

  return (
    <div className="page-stack">
      <section aria-label="Summary">
        <div className="stat-grid">
          <StatCard
            label="Open tasks"
            value={loading ? "—" : String(summary.openTasks)}
            hint={loading ? undefined : `${summary.blocked} blocked${summary.unassigned ? ` · ${summary.unassigned} unassigned` : ""}`}
          />
          <StatCard label="Overdue tasks" value={loading ? "—" : String(summary.overdue)} tone={summary.overdue > 0 ? "alert" : "default"} />
          <StatCard label="Overloaded members" value={loading ? "—" : String(summary.overloaded)} hint="Above 100% of weekly capacity" tone={summary.overloaded > 0 ? "alert" : "default"} />
          <StatCard
            label="Average load"
            value={loading ? "—" : `${summary.average}%`}
            hint={loading ? undefined : `Open estimated hours vs capacity${summary.withoutEstimate ? ` · ${summary.withoutEstimate} task${summary.withoutEstimate === 1 ? "" : "s"} without estimate not counted` : ""}`}
          />
        </div>
      </section>

      <div className="toolbar">
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-project`}>
            Filter by project
          </label>
          <select id={`${id}-project`} className="form-input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="ALL">All projects</option>
            {[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="status-region" role="status" aria-live="polite">
        {done && <p className="notice">{done}</p>}
      </div>
      {actions.error && (
        <div className="form-alert" role="alert">
          <span>{actions.error}</span>
        </div>
      )}

      {loading ? (
        <p className="empty-state panel">Loading team workload…</p>
      ) : rows.length === 0 ? (
        <p className="empty-state panel">No team members yet.</p>
      ) : (
        <ul className="workload-list">
          {rows.map((r) => (
            <WorkloadRow
              key={r.member.id}
              member={r.member}
              workload={r.workload}
              openTasks={r.openTasks}
              overdueIds={r.overdueIds}
              projectNames={projectNames}
              expanded={expanded.has(r.member.id)}
              onToggle={() => toggle(r.member.id)}
              reassigningId={reassigningId}
              onStartReassign={(task) => {
                actions.clearError();
                setDone(null);
                setReassigningId(task.id);
              }}
              onCancelReassign={() => setReassigningId(null)}
              reassignOptions={reassignOptions}
              onReassign={(task, assigneeId) => void handleReassign(task, assigneeId)}
              busy={actions.submitting}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default WorkloadPage;
