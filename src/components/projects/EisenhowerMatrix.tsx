import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Dependency, Project, Task, TeamMember } from '../../services/client';
import { formatDate, todayIsoDate } from '../../utils/dates';
import { isOpenForMatrix, projectPriority, taskPriority } from '../../utils/eisenhower';
import type { Quadrant } from '../../utils/eisenhower';
import { TASK_STATUS_LABELS } from '../../utils/projectLabels';
import { projectPath } from '../../utils/routes';
import StatusBadge from '../ui/StatusBadge';

const QUADRANTS: ReadonlyArray<{ id: Quadrant; title: string; action: { projects: string; tasks: string } }> = [
  { id: 'DO_FIRST', title: 'Do first — important & urgent', action: { projects: 'Act now: unblock overdue work and protect the deadline.', tasks: 'Work on these now, or flag a blocker.' } },
  { id: 'SCHEDULE', title: 'Schedule — important, not urgent', action: { projects: 'Plan milestones and time before it becomes urgent.', tasks: 'Plan time for these before they become urgent.' } },
  { id: 'DELEGATE', title: 'Delegate — urgent, less important', action: { projects: 'Hand off or reassign to a team member with capacity.', tasks: 'Handle quickly, or ask your manager to reassign.' } },
  { id: 'DEPRIORITIZE', title: 'Deprioritize — not urgent, less important', action: { projects: 'Postpone or reconsider the scope.', tasks: 'Do these after the rest, or discuss dropping them.' } },
];

interface Entry {
  key: string;
  name: string;
  to: string;
  /** Status pill (projects) or status text (tasks). */
  badge: ReactNode;
  /** Second line under the name (the project, for a task). */
  context?: ReactNode;
  deadline: string | null | undefined;
  importance: number | null;
  urgency: number | null;
  quadrant: Quadrant | null;
  daysToDeadline: number | null;
  reasons: string[];
}

/** "Overdue by 3 days" / "Due today" / "5 days left" / "No deadline". */
function timing(days: number | null): { text: string; overdue: boolean } {
  if (days === null) return { text: 'No deadline', overdue: false };
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${days === -1 ? '' : 's'}`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: false };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, overdue: false };
}

function EntryItem({ entry }: { entry: Entry }) {
  const when = timing(entry.daysToDeadline);
  return (
    <li className={`eisenhower-card${when.overdue ? ' eisenhower-card--overdue' : ''}`}>
      <div className="eisenhower-card__top">
        <Link className="eisenhower-card__name" to={entry.to}>{entry.name}</Link>
        {entry.badge}
      </div>
      {entry.context && <p className="eisenhower-card__meta">{entry.context}</p>}
      <p className="eisenhower-card__meta">
        <span className={when.overdue ? 'text-error' : undefined}>{when.text}</span>
        {entry.deadline && <> · Deadline {formatDate(entry.deadline)}</>}
      </p>
      <p className="eisenhower-card__meta">
        Importance {entry.importance ?? '?'}/5 · Urgency {entry.urgency ?? '?'}/5
      </p>
      <p className="eisenhower-card__reason"><span className="visually-hidden">Why: </span>{entry.reasons.join(' · ')}</p>
    </li>
  );
}

export interface EisenhowerMatrixProps {
  /**
   * "projects": the managers' overview of every project the user can see.
   * "tasks": an employee's own open tasks (pass only the tasks assigned to them).
   */
  mode: 'projects' | 'tasks';
  projects: Project[];
  tasks: Task[];
  dependencies: Dependency[];
  members: TeamMember[];
  /** Every task the user can read, to tell whether a task's dependencies are finished ("tasks" mode). */
  allTasks?: Task[];
}

/**
 * Eisenhower matrix, recomputed live from deadlines (time left, overdue, blocked work) and business
 * impact. Items without enough data are listed apart under "Assessment needed", never silently placed.
 */
export default function EisenhowerMatrix({ mode, projects, tasks, dependencies, members, allTasks = tasks }: EisenhowerMatrixProps) {
  const today = todayIsoDate();
  const entries = useMemo<Entry[]>(() => {
    let list: Entry[];
    if (mode === 'projects') {
      list = projects
        .filter((p) => p.status !== 'CLOSED')
        .map((project) => {
          const p = projectPriority(project, tasks, dependencies, today, members);
          return { key: project.id, name: project.name, to: projectPath(project.id), badge: <StatusBadge status={project.status} />, deadline: project.endDate, ...p };
        });
    } else {
      const projectsById = new Map(projects.map((p) => [p.id, p]));
      const tasksById = new Map(allTasks.map((t) => [t.id, t]));
      list = tasks.filter(isOpenForMatrix).map((task) => {
        const project = projectsById.get(task.projectId);
        const p = taskPriority(task, project, dependencies, tasksById, today);
        return {
          key: task.id,
          name: task.title,
          to: `${projectPath(task.projectId)}?task=${encodeURIComponent(task.id)}`,
          badge: task.status ? <span className={`status-text status-text--${task.status.toLowerCase()}`}>{TASK_STATUS_LABELS[task.status]}</span> : null,
          context: project ? <>Project <Link to={projectPath(project.id)}>{project.name}</Link></> : undefined,
          deadline: task.dueDate,
          ...p,
        };
      });
    }
    return list.sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0) || (b.importance ?? 0) - (a.importance ?? 0));
  }, [mode, projects, tasks, allTasks, dependencies, members, today]);
  const unassessed = entries.filter((e) => !e.quadrant);
  const noun = mode === 'projects' ? 'projects' : 'tasks';

  return (
    <section className="panel eisenhower" aria-labelledby="eisenhower-title">
      <h2 id="eisenhower-title" className="panel__title">{mode === 'projects' ? 'Project priority matrix' : 'My priority matrix'}</h2>
      {mode === 'projects' ? (
        <p className="form-hint">
          Team overview. Urgency comes from project and task deadlines, overdue or blocked work, progress against the
          timeline and team workload. Importance comes from the business impact. Managers can set or override both in each
          project's settings.
        </p>
      ) : (
        <p className="form-hint">
          Your open tasks. Urgency comes from the time left before each due date (and blocked work); importance combines
          the project's business impact with the task's priority.
        </p>
      )}
      <div className="eisenhower__grid">
        {QUADRANTS.map((q) => {
          const inQuadrant = entries.filter((e) => e.quadrant === q.id);
          return (
            <section key={q.id} className={`eisenhower__quadrant eisenhower__quadrant--${q.id.toLowerCase()}`} aria-labelledby={`eq-${q.id}`}>
              <h3 id={`eq-${q.id}`}>
                {q.title} <span className="kanban__count">{inQuadrant.length}</span>
              </h3>
              <p className="eisenhower__action">{q.action[mode]}</p>
              {inQuadrant.length ? (
                <ul className="eisenhower__list">{inQuadrant.map((e) => <EntryItem key={e.key} entry={e} />)}</ul>
              ) : (
                <p className="empty-state">No {noun}.</p>
              )}
            </section>
          );
        })}
      </div>
      {unassessed.length > 0 && (
        <section className="eisenhower__unknown" aria-labelledby="eq-unknown">
          <h3 id="eq-unknown">Assessment needed <span className="kanban__count">{unassessed.length}</span></h3>
          <p className="eisenhower__action">
            {mode === 'projects'
              ? 'Importance or urgency is unknown (no business impact or no deadline), so these projects are not placed in a quadrant. Set them in the project settings.'
              : 'Importance or urgency is unknown (no due date, or no business impact and no priority), so these tasks are not placed in a quadrant. Ask your manager to set them.'}
          </p>
          <ul className="eisenhower__list">{unassessed.map((e) => <EntryItem key={e.key} entry={e} />)}</ul>
        </section>
      )}
    </section>
  );
}
