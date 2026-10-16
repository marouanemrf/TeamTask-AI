import { useEffect, useMemo, useState } from "react";
import RecentProjects from "../components/projects/RecentProjects";
import TaskList from "../components/tasks/TaskList";
import StatCard from "../components/ui/StatCard";
import { useTeamMembers } from "../hooks/useTeam";
import { useProjects } from "../hooks/useProjects";
import { useAllTasksBoard } from "../hooks/useTasks";
import EisenhowerMatrix from "../components/projects/EisenhowerMatrix";
import { useUser } from "../hooks/useUser";
import { observeOpenEscalationCount } from "../services/automationService";
import { ROUTES } from "../utils/routes";
import { todayIsoDate } from "../utils/dates";
import { completionPercent, isOverdue, upcomingTasks } from "../utils/taskStats";

const MAX_ITEMS = 5;

function DashboardPage() {
  const { isManager } = useUser();
  const [openEscalations, setOpenEscalations] = useState(0);
  useEffect(() => isManager ? observeOpenEscalationCount(setOpenEscalations, (error) => console.error("[Dashboard] Escalation count failed", error)) : undefined, [isManager]);
  const { projects, loading: projectsLoading } = useProjects();
  const board = useAllTasksBoard();
  const tasks = board.tasks;
  const tasksLoading = board.loading;
  const myMemberIds = board.myMemberIds;
  const membersLoading = board.loading;
  const { members } = useTeamMembers();
  const today = todayIsoDate();

  // --- Stat cards: team-wide for managers, the user's own tasks for everyone else ---
  const statTasks = isManager ? tasks : board.myTasks;
  const stats = useMemo(() => {
    const done = statTasks.filter((t) => t.status === "DONE").length;
    return {
      activeProjects: projects.filter((p) => p.status === "ACTIVE").length,
      totalTasks: statTasks.length,
      done,
      donePercent: completionPercent(statTasks),
      overdue: statTasks.filter((t) => isOverdue(t, today)).length,
    };
  }, [projects, statTasks, today]);

  // --- Lists ---
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const myUpcoming = useMemo(() => {
    const mine = new Set(myMemberIds);
    return upcomingTasks(
      tasks.filter((t) => t.assigneeId && mine.has(t.assigneeId)),
      MAX_ITEMS,
    );
  }, [tasks, myMemberIds]);
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ITEMS),
    [projects],
  );

  const show = (value: number, loading: boolean) => (loading ? "—" : String(value));

  return (
    <div className="page-stack">
      <section aria-label="Key figures">
        <div className="stat-grid">
          <StatCard label="Active projects" value={show(stats.activeProjects, projectsLoading)} />
          <StatCard label={isManager ? "Total tasks" : "My tasks"} value={show(stats.totalTasks, tasksLoading)} />
          <StatCard
            label={isManager ? "Completed tasks" : "My completed tasks"}
            value={tasksLoading ? "—" : `${stats.donePercent}%`}
            hint={tasksLoading ? undefined : `${stats.done} of ${stats.totalTasks}`}
          />
          {isManager && <StatCard label="Open escalations" value={String(openEscalations)} tone={openEscalations ? "alert" : "default"} to={ROUTES.escalations} linkLabel="Handle escalations" />}
          <StatCard
            label={isManager ? "Overdue tasks" : "My overdue tasks"}
            value={show(stats.overdue, tasksLoading)}
            tone={stats.overdue > 0 ? "alert" : "default"}
            to={isManager ? ROUTES.workload : ROUTES.myTasks}
            linkLabel={isManager ? "See team workload" : "See my tasks"}
          />
        </div>
      </section>

      <div className="two-columns">
        <section className="panel" aria-labelledby="my-tasks-title">
          <h2 id="my-tasks-title" className="panel__title">
            My upcoming tasks
          </h2>
          {tasksLoading || membersLoading ? (
            <p className="empty-state">Loading…</p>
          ) : (
            <TaskList
              tasks={myUpcoming}
              projectNames={projectNames}
              today={today}
              emptyMessage="No tasks are assigned to you."
            />
          )}
        </section>

        <section className="panel" aria-labelledby="recent-projects-title">
          <h2 id="recent-projects-title" className="panel__title">
            Recent projects
          </h2>
          {projectsLoading ? <p className="empty-state">Loading…</p> : <RecentProjects projects={recentProjects} />}
        </section>
      </div>
      {/* Managers get the team-wide project overview; everyone else a matrix of their own tasks. */}
      {!projectsLoading && !tasksLoading && (isManager ? (
        <EisenhowerMatrix mode="projects" projects={projects} tasks={tasks} dependencies={board.dependencies} members={members} />
      ) : (
        <EisenhowerMatrix mode="tasks" projects={projects} tasks={board.myTasks} allTasks={tasks} dependencies={board.dependencies} members={members} />
      ))}
    </div>
  );
}

export default DashboardPage;
