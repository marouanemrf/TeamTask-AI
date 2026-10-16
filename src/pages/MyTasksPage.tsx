import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import BlockerModal from "../components/tasks/BlockerModal";
import MyTaskRow from "../components/tasks/MyTaskRow";
import TaskDetailDrawer from "../components/tasks/TaskDetailDrawer";
import { ChevronDownIcon } from "../components/ui/Icons";
import { useProjects } from "../hooks/useProjects";
import { useTeamMembers } from "../hooks/useTeam";
import { useAllTasksBoard, useStatusEvents, useTaskActions } from "../hooks/useTasks";
import { useUser } from "../hooks/useUser";
import type { Task, TaskPriority, TaskStatus } from "../services/client";
import { dueBucket, isWithinLastDays, todayIsoDate } from "../utils/dates";
import { PRIORITY_LABELS, TASK_PRIORITIES, TASK_STATUS_LABELS } from "../utils/projectLabels";
import { blockReasonFor, canChangeStatus, checkStatusChange, completedAt, isOpenTask, isOverdue } from "../utils/taskRules";
import LoadingState from "../components/ui/LoadingState";

const FILTER_STATUSES: readonly TaskStatus[] = ["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const RECENT_DAYS = 7;

const byDueDate = (a: Task, b: Task) =>
  (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.title.localeCompare(b.title);

function Section({ title, count, children, collapsible = false }: { title: string; count: number; children: ReactNode; collapsible?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className="my-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="my-section__title">
        {collapsible ? (
          <button type="button" className="proposals__toggle" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen((v) => !v)}>
            <ChevronDownIcon />
            {title} <span className="kanban__count">{count}</span>
          </button>
        ) : (
          <>
            {title} <span className="kanban__count">{count}</span>
          </>
        )}
      </h2>
      {open && (
        <div id={`${id}-list`}>
          {count === 0 ? <p className="empty-state my-section__empty">Nothing here.</p> : <ul className="my-task-list">{children}</ul>}
        </div>
      )}
    </section>
  );
}

/** Tasks assigned to the signed-in user, across projects, grouped by urgency. */
function MyTasksPage() {
  const id = useId();
  const { isManager, primaryRole } = useUser();
  const board = useAllTasksBoard();
  const actions = useTaskActions(board.patch);
  const statusEvents = useStatusEvents();
  const { projects } = useProjects();
  const { members } = useTeamMembers();
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const [notice, setNotice] = useState<string | null>(null);
  const [blockerTask, setBlockerTask] = useState<Task | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const today = todayIsoDate();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const who = { isManager, isViewer: primaryRole === "VIEWER", myMemberIds: board.myMemberIds };
  const myProjects = useMemo(
    () => [...new Set(board.myTasks.map((t) => t.projectId))].map((pid) => ({ id: pid, name: projectNames.get(pid) ?? "Unknown project" })).sort((a, b) => a.name.localeCompare(b.name)),
    [board.myTasks, projectNames],
  );

  // Filter, then split into the four sections (each sorted by due date).
  const sections = useMemo(() => {
    const filtered = board.myTasks.filter(
      (t) =>
        (projectFilter === "ALL" || t.projectId === projectFilter) &&
        (priorityFilter === "ALL" || t.priority === priorityFilter) &&
        (statusFilter === "ALL" || t.status === statusFilter),
    );
    const open = filtered.filter(isOpenTask).sort(byDueDate);
    return {
      overdue: open.filter((t) => dueBucket(t.dueDate, today) === "overdue"),
      thisWeek: open.filter((t) => dueBucket(t.dueDate, today) === "thisWeek"),
      later: open.filter((t) => dueBucket(t.dueDate, today) === "later"),
      recentlyDone: filtered
        .filter((t) => isWithinLastDays(completedAt(t, statusEvents.get(t.id)), RECENT_DAYS))
        .sort((a, b) => (completedAt(b, statusEvents.get(b.id)) ?? "").localeCompare(completedAt(a, statusEvents.get(a.id)) ?? "")),
    };
  }, [board.myTasks, projectFilter, priorityFilter, statusFilter, today, statusEvents]);

  /** Same rules as the Kanban: permission, then dependencies (IN_PROGRESS / DONE). */
  async function changeStatus(task: Task, status: TaskStatus, reason?: string): Promise<boolean> {
    actions.clearError();
    if (!canChangeStatus(task, who)) {
      setNotice("You can only change the status of tasks assigned to you.");
      return false;
    }
    const check = checkStatusChange(task, status, board.dependencies, board.tasksById, (s) => TASK_STATUS_LABELS[s]);
    if (!check.ok) {
      setNotice(check.reason);
      return false;
    }
    setNotice(null);
    return actions.move(task, status, reason);
  }

  function handleSelect(task: Task, status: TaskStatus) {
    // Blocked always needs a reason: go through the blocker dialog.
    if (status === "BLOCKED") {
      actions.clearError();
      setBlockerTask(task);
      return;
    }
    void changeStatus(task, status);
  }

  const row = (task: Task) => (
    <MyTaskRow
      key={task.id}
      task={task}
      projectName={projectNames.get(task.projectId) ?? "Unknown project"}
      overdue={isOverdue(task, today)}
      block={blockReasonFor(task, statusEvents.get(task.id))}
      canChange={canChangeStatus(task, who)}
      busy={actions.submitting}
      onStatusChange={(status) => handleSelect(task, status)}
      onReportBlocker={() => {
        actions.clearError();
        setBlockerTask(task);
      }}
      onOpen={() => setSelectedId(task.id)}
    />
  );

  const selected = selectedId ? board.tasksById.get(selectedId) : undefined;
  const error = notice ?? actions.error;
  const total = sections.overdue.length + sections.thisWeek.length + sections.later.length + sections.recentlyDone.length;

  if (board.loading) return <LoadingState className="empty-state panel">Loading your tasks…</LoadingState>;
  if (board.myTasks.length === 0) return <p className="empty-state panel">No tasks assigned.</p>;

  return (
    <div className="page-stack">
      {/* Filters */}
      <div className="toolbar" role="group" aria-label="Filters">
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-project`}>
            Filter by project
          </label>
          <select id={`${id}-project`} className="form-input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="ALL">All projects</option>
            {myProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-priority`}>
            Filter by priority
          </label>
          <select id={`${id}-priority`} className="form-input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "ALL")}>
            <option value="ALL">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-status`}>
            Filter by status
          </label>
          <select id={`${id}-status`} className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "ALL")}>
            <option value="ALL">All statuses</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && !blockerTask && !selected && (
        <div className="form-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="button-secondary alert__action"
            onClick={() => {
              setNotice(null);
              actions.clearError();
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {total === 0 ? (
        <p className="empty-state panel">No tasks match these filters.</p>
      ) : (
        <>
          <Section title="Overdue" count={sections.overdue.length}>
            {sections.overdue.map(row)}
          </Section>
          <Section title="This week" count={sections.thisWeek.length}>
            {sections.thisWeek.map(row)}
          </Section>
          <Section title="Later" count={sections.later.length}>
            {sections.later.map(row)}
          </Section>
          <Section title="Recently completed" count={sections.recentlyDone.length} collapsible>
            {sections.recentlyDone.map(row)}
          </Section>
        </>
      )}

      {blockerTask && (
        <BlockerModal
          task={blockerTask}
          submitting={actions.submitting}
          error={error}
          onSubmit={(reason) => changeStatus(blockerTask, "BLOCKED", reason)}
          onClose={() => {
            setBlockerTask(null);
            setNotice(null);
          }}
        />
      )}

      {selected && (
        <TaskDetailDrawer
          task={selected}
          projectName={projectNames.get(selected.projectId) ?? "Unknown project"}
          tasksById={board.tasksById}
          projectTasks={board.tasks.filter((t) => t.projectId === selected.projectId)}
          dependencies={board.dependencies}
          membersById={membersById}
          today={today}
          canEdit={false}
          canMove={canChangeStatus(selected, who)}
          busy={actions.submitting}
          error={error}
          onMove={(status) => handleSelect(selected, status)}
          onEdit={() => undefined}
          onCancelTask={() => undefined}
          onOpenTask={(t) => setSelectedId(t.id)}
          onClose={() => {
            setSelectedId(null);
            setNotice(null);
          }}
        />
      )}
    </div>
  );
}

export default MyTasksPage;
