import type { Dependency, Project, Task, TeamMember } from '../services/client';
export type Quadrant = 'DO_FIRST' | 'SCHEDULE' | 'DELEGATE' | 'DEPRIORITIZE';
export interface ProjectPriority { importance: number | null; urgency: number | null; quadrant: Quadrant | null; reasons: string[]; daysLate: number | null; /** Days until the nearest project or open-task deadline (negative = overdue), null if none. */ daysToDeadline: number | null; overdueTasks: number; blockedTasks: number }
const IMPACT: Record<string, number> = { LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };
const validScore = (value: number | null | undefined): number | null => value !== null && value !== undefined && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
export function projectPriority(project: Project, tasks: readonly Task[], dependencies: readonly Dependency[], today = new Date().toISOString().slice(0, 10), members: readonly TeamMember[] = []): ProjectPriority {
  const importance = project.importanceOverride === null || project.importanceOverride === undefined ? (project.businessImpact ? IMPACT[project.businessImpact] : null) : validScore(project.importanceOverride);
  const projectDays = project.endDate ? Math.floor((Date.parse(`${project.endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  const active = tasks.filter((t) => t.projectId === project.id && !['DONE', 'CANCELLED'].includes(t.status ?? 'TODO'));
  const overdueTasks = active.filter((t) => !!t.dueDate && t.dueDate < today).length;
  const nearestTaskDays = active.flatMap((task) => task.dueDate ? [Math.floor((Date.parse(`${task.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)] : []).sort((a, b) => a - b)[0] ?? null;
  const days = projectDays === null ? nearestTaskDays : nearestTaskDays === null ? projectDays : Math.min(projectDays, nearestTaskDays);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const blockedTasks = active.filter((task) => task.status === 'BLOCKED' || dependencies.some((dep) => dep.fromTaskId === task.id && !['DONE', 'CANCELLED'].includes(tasksById.get(dep.toTaskId)?.status ?? 'TODO'))).length;
  let automaticUrgency = days === null && overdueTasks === 0 && blockedTasks === 0 ? null : Math.min(5, Math.max(days !== null && days < 0 || overdueTasks > 0 ? 5 : 1, days !== null && days <= 7 || blockedTasks > 0 ? 4 : days !== null && days <= 21 ? 3 : 1));
  const total = tasks.filter((task) => task.projectId === project.id).length;
  const done = tasks.filter((task) => task.projectId === project.id && task.status === 'DONE').length;
  const loadWarnings = members.flatMap((member) => {
    const hours = active.filter((task) => task.assigneeId === member.id).reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
    const capacity = member.weeklyCapacityHours ?? 0;
    return capacity > 0 && hours > capacity ? [`${member.name} at ${Math.round(hours / capacity * 100)}% estimated capacity`] : [];
  });
  if (project.startDate && project.endDate && total && automaticUrgency !== null) {
    const elapsed = Math.max(0, Math.min(1, (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${project.startDate}T00:00:00Z`)) / Math.max(1, Date.parse(`${project.endDate}T00:00:00Z`) - Date.parse(`${project.startDate}T00:00:00Z`))));
    if (elapsed - done / total >= .2) automaticUrgency = Math.min(5, automaticUrgency + 1);
  }
  if (automaticUrgency !== null && loadWarnings.length) automaticUrgency = Math.min(5, automaticUrgency + 1);
  const urgency = project.urgencyOverride === null || project.urgencyOverride === undefined ? automaticUrgency : validScore(project.urgencyOverride);
  const reasons: string[] = [];
  if (project.importanceOverride !== null && project.importanceOverride !== undefined) reasons.push(`importance override ${importance}/5`);
  else if (project.businessImpact) reasons.push(`business impact ${project.businessImpact.toLowerCase()}`);
  else reasons.push('importance not assessed');
  if (project.urgencyOverride !== null && project.urgencyOverride !== undefined) reasons.push(`urgency override ${urgency}/5`);
  else if (days !== null && days < 0) reasons.push(`${Math.abs(days)} days overdue`);
  else if (days !== null) reasons.push(`${days} days until next deadline`);
  else reasons.push('no project or task deadline');
  if (project.startDate && project.endDate && total) reasons.push(`progress ${Math.round(done / total * 100)}% against timeline`);
  reasons.push(...loadWarnings);
  if (overdueTasks) reasons.push(`${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'}`);
  if (blockedTasks) reasons.push(`${blockedTasks} blocked task${blockedTasks === 1 ? '' : 's'}`);
  const isImportant = importance !== null && importance >= 4; const isUrgent = urgency !== null && urgency >= 4;
  const quadrant = importance === null || urgency === null ? null : isImportant ? isUrgent ? 'DO_FIRST' : 'SCHEDULE' : isUrgent ? 'DELEGATE' : 'DEPRIORITIZE';
  return { importance, urgency, quadrant, reasons, daysLate: projectDays !== null && projectDays < 0 ? Math.abs(projectDays) : null, daysToDeadline: days, overdueTasks, blockedTasks };
}

const TASK_PRIORITY: Record<string, number> = { LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };
const OPEN_TASK = new Set(['TODO', 'IN_PROGRESS', 'BLOCKED']);
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface TaskPriority {
  importance: number | null;
  urgency: number | null;
  quadrant: Quadrant | null;
  reasons: string[];
  /** Days until the task's due date (negative = overdue), null without a due date. */
  daysToDeadline: number | null;
  /** The project's business impact (or authorized importance override) as a 1–5 score; kept separate from importance. */
  businessImpact: number | null;
  blocked: boolean;
}

/** Tasks the Eisenhower matrix considers: accepted work that is not finished. */
export const isOpenForMatrix = (task: Task) => OPEN_TASK.has(task.status ?? 'TODO');

/**
 * One task's place in the matrix, recomputed against `today`:
 * - urgency (1–5) from the time left before the due date — overdue 5, ≤ 7 days 4, ≤ 21 days 3, later 1 —
 *   and at least 4 while blocked (status or unfinished dependency), the same scale as projects;
 * - importance (1–5) from the project's business impact and the task's own priority (their rounded
 *   mean, or whichever is set). Both inputs stay visible in the reasons.
 * Unknown data never counts as urgent or important: no due date and not blocked → urgency unknown;
 * neither business impact nor priority → importance unknown; the task is then not placed.
 */
export function taskPriority(task: Task, project: Project | undefined, dependencies: readonly Dependency[], tasksById: ReadonlyMap<string, Task>, today = new Date().toISOString().slice(0, 10)): TaskPriority {
  const businessImpact = project
    ? project.importanceOverride === null || project.importanceOverride === undefined ? (project.businessImpact ? IMPACT[project.businessImpact] : null) : validScore(project.importanceOverride)
    : null;
  const own = task.priority ? TASK_PRIORITY[task.priority] ?? null : null;
  const importance = businessImpact !== null && own !== null ? Math.round((businessImpact + own) / 2) : businessImpact ?? own;

  const days = task.dueDate ? daysBetween(today, task.dueDate) : null;
  const blocked = task.status === 'BLOCKED' || dependencies.some((d) => d.fromTaskId === task.id && !['DONE', 'CANCELLED'].includes(tasksById.get(d.toTaskId)?.status ?? 'TODO'));
  const byDeadline = days === null ? null : days < 0 ? 5 : days <= 7 ? 4 : days <= 21 ? 3 : 1;
  const urgency = byDeadline === null && !blocked ? null : Math.max(byDeadline ?? 1, blocked ? 4 : 1);

  const reasons: string[] = [];
  if (project?.importanceOverride !== null && project?.importanceOverride !== undefined) reasons.push(`project importance override ${businessImpact}/5`);
  else if (project?.businessImpact) reasons.push(`business impact ${project.businessImpact.toLowerCase()}`);
  else reasons.push('business impact not assessed');
  reasons.push(task.priority ? `task priority ${task.priority.toLowerCase()}` : 'task priority not set');
  if (days === null) reasons.push('no due date');
  else if (days < 0) reasons.push(`${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`);
  else reasons.push(`${days} day${days === 1 ? '' : 's'} until due date`);
  if (blocked) reasons.push('blocked');

  const quadrant = importance === null || urgency === null ? null : importance >= 4 ? (urgency >= 4 ? 'DO_FIRST' : 'SCHEDULE') : urgency >= 4 ? 'DELEGATE' : 'DEPRIORITIZE';
  return { importance, urgency, quadrant, reasons, daysToDeadline: days, businessImpact, blocked };
}
