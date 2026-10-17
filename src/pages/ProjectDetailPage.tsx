import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AiPlanPanel from "../components/projects/AiPlanPanel";
import MilestonesPanel from "../components/projects/MilestonesPanel";
import ProjectEditModal from "../components/projects/ProjectEditModal";
import ProjectHeader from "../components/projects/ProjectHeader";
import KanbanBoard from "../components/tasks/KanbanBoard";
import TaskDetailDrawer from "../components/tasks/TaskDetailDrawer";
import TaskFormModal from "../components/tasks/TaskFormModal";
import TaskListTable from "../components/tasks/TaskListTable";
import { PlusIcon } from "../components/ui/Icons";
import { useMilestones, useProject, useProjectActions } from "../hooks/useProject";
import { useMyTeamMemberIds, useTeamMembers } from "../hooks/useTeam";
import { useProjectBoard, useStatusEvents, useTaskActions, useTasks } from "../hooks/useTasks";
import { useUser } from "../hooks/useUser";
import type { Task, TaskStatus } from "../services/client";
import type { ProjectChanges } from "../services/projectService";
import type { TaskInput } from "../services/taskService";
import { todayIsoDate } from "../utils/dates";
import { TASK_STATUS_LABELS } from "../utils/projectLabels";
import { projectReportsPath, ROUTES } from "../utils/routes";
import { canChangeStatus, checkStatusChange, projectProgress } from "../utils/taskRules";
import LoadingState from "../components/ui/LoadingState";
import { useToastMessage } from "../hooks/useToast";

const TABS = [
  { id: "kanban", label: "Kanban board" },
  { id: "list", label: "Task list" },
  { id: "milestones", label: "Milestones" },
  // Managers only (see visibleTabs).
  { id: "ai-plan", label: "AI plan" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function ProjectDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isManager, primaryRole } = useUser();
  const { project, loading, replace } = useProject(id);
  const projectActions = useProjectActions();
  const board = useProjectBoard(id);
  const taskActions = useTaskActions(board.patch);
  const milestones = useMilestones(id);
  const { members } = useTeamMembers();
  const { tasks: allTasks } = useTasks();
  const { ids: myMemberIds } = useMyTeamMemberIds();
  const statusEvents = useStatusEvents();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<{ task?: Task } | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleTabs = TABS.filter((t) => t.id !== "ai-plan" || isManager);
  const tabParam = searchParams.get("tab");
  const tab: TabId = visibleTabs.some((t) => t.id === tabParam) ? (tabParam as TabId) : "kanban";
  const today = todayIsoDate();
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const progress = useMemo(() => projectProgress(board.tasks), [board.tasks]);
  const boardTasks = useMemo(() => board.tasks.filter((t) => t.status !== "CANCELLED"), [board.tasks]);
  const who = { isManager, isViewer: primaryRole === "VIEWER", myMemberIds };
  const canMove = (task: Task) => canChangeStatus(task, who);
  const selected = selectedTaskId ? board.tasksById.get(selectedTaskId) : undefined;
  const actionError = notice ?? taskActions.error;

  useEffect(() => {
    const taskId = searchParams.get("task");
    if (taskId && board.tasksById.has(taskId)) setSelectedTaskId(taskId);
  }, [searchParams, board.tasksById]);

  /** Permission + dependency rule, then an optimistic save. */
  async function handleMove(task: Task, status: TaskStatus) {
    taskActions.clearError();
    if (!canChangeStatus(task, who)) {
      setNotice(who.isViewer ? "Viewers can't change task status." : "You can only move tasks assigned to you.");
      return;
    }
    const check = checkStatusChange(task, status, board.dependencies, board.tasksById, (s) => TASK_STATUS_LABELS[s]);
    if (!check.ok) {
      setNotice(check.reason);
      return;
    }
    setNotice(null);
    await taskActions.move(task, status);
  }

  async function handleTaskSubmit(input: TaskInput, dependsOn: string[]) {
    const saved = form?.task
      ? await taskActions.update(form.task, input, dependsOn)
      : await taskActions.create(input, dependsOn);
    return saved !== null;
  }

  async function handleProjectSubmit(changes: ProjectChanges) {
    if (!project) return false;
    const saved = await projectActions.update(project, changes);
    if (saved) replace(saved);
    return saved !== null;
  }

  function selectTab(next: TabId) {
    setSearchParams(next === "kanban" ? {} : { tab: next }, { replace: true });
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = visibleTabs.findIndex((t) => t.id === tab);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1 : (index + delta + visibleTabs.length) % visibleTabs.length;
    selectTab(visibleTabs[nextIndex].id);
    document.getElementById(`tab-${visibleTabs[nextIndex].id}`)?.focus();
  }

  // Action errors and rule explanations: notification (the drawer and the form show their own).
  useToastMessage(actionError && !selected && !form ? actionError : null, notice ? "warning" : "error", () => {
    setNotice(null);
    taskActions.clearError();
  });

  if (loading) return <LoadingState className="empty-state panel">Loading project…</LoadingState>;

  if (!project) {
    return (
      <div className="panel">
        <p>Project not found.</p>
        <p className="panel__footer">
          <Link className="text-link" to={ROUTES.projects}>
            Back to projects
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <ProjectHeader
        project={project}
        progress={progress}
        canEdit={isManager}
        onEdit={() => {
          projectActions.clearError();
          setEditingProject(true);
        }}
      />
      <p><Link className="text-link" to={projectReportsPath(project.id)}>Weekly reports</Link></p>

      {/* Tabs */}
      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Project views">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              className="tabs__tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={handleTabKeyDown}
            >
              {t.label}
            </button>
          ))}
        </div>
        {isManager && tab !== "milestones" && tab !== "ai-plan" && (
          <button
            type="button"
            className="button-primary button-primary--inline"
            onClick={() => {
              taskActions.clearError();
              setForm({});
            }}
          >
            <PlusIcon />
            <span>New task</span>
          </button>
        )}
      </div>


      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="tab-panel">
        {tab === "ai-plan" ? (
          <AiPlanPanel project={project} members={members} allTasks={allTasks} today={today} onShowBoard={() => selectTab("kanban")} />
        ) : tab === "milestones" ? (
          <MilestonesPanel
            milestones={milestones.milestones}
            loading={milestones.loading}
            today={today}
            canCreate={isManager}
            submitting={milestones.submitting}
            error={milestones.error}
            onCreate={milestones.create}
          />
        ) : board.loading ? (
          <LoadingState className="empty-state panel">Loading tasks…</LoadingState>
        ) : tab === "list" ? (
          <TaskListTable
            tasks={board.tasks}
            dependencies={board.dependencies}
            tasksById={board.tasksById}
            membersById={membersById}
            today={today}
            onOpen={(t) => setSelectedTaskId(t.id)}
          />
        ) : (
          <KanbanBoard
            tasks={boardTasks}
            dependencies={board.dependencies}
            tasksById={board.tasksById}
            membersById={membersById}
            statusEvents={statusEvents}
            today={today}
            canMove={canMove}
            onMove={(task, status) => void handleMove(task, status)}
            onOpen={(t) => setSelectedTaskId(t.id)}
          />
        )}
      </div>

      <p>
        <Link className="text-link" to={ROUTES.projects}>
          ← Back to projects
        </Link>
      </p>

      {selected && (
        <TaskDetailDrawer
          task={selected}
          projectName={project.name}
          tasksById={board.tasksById}
          projectTasks={board.tasks}
          dependencies={board.dependencies}
          membersById={membersById}
          today={today}
          canEdit={isManager}
          canMove={canMove(selected)}
          busy={taskActions.submitting}
          error={actionError}
          onMove={(status) => void handleMove(selected, status)}
          onEdit={() => {
            taskActions.clearError();
            setForm({ task: selected });
          }}
          onCancelTask={() => {
            setNotice(null);
            void taskActions.cancel(selected);
          }}
          onOpenTask={(t) => setSelectedTaskId(t.id)}
          onClose={() => {
            setSelectedTaskId(null);
            setNotice(null);
            if (searchParams.has("task")) {
              const next = new URLSearchParams(searchParams);
              next.delete("task");
              setSearchParams(next, { replace: true });
            }
          }}
        />
      )}

      {form && (
        <TaskFormModal
          project={project}
          task={form.task}
          projectTasks={board.tasks}
          dependencies={board.dependencies}
          members={members}
          allTasks={allTasks}
          submitting={taskActions.submitting}
          error={taskActions.error}
          onSubmit={handleTaskSubmit}
          onClose={() => setForm(null)}
        />
      )}

      {editingProject && (
        <ProjectEditModal
          project={project}
          submitting={projectActions.submitting}
          error={projectActions.error}
          onSubmit={handleProjectSubmit}
          onClose={() => setEditingProject(false)}
        />
      )}
    </div>
  );
}

export default ProjectDetailPage;
