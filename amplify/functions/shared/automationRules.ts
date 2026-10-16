import type { TaskStatusValue } from './rules';

export interface DeadlineTaskLike {
  id: string;
  status?: TaskStatusValue | null;
  dueDate?: string | null;
  priority?: string | null;
  assigneeId?: string | null;
}

export interface DeadlineSelection {
  sendReminder: boolean;
  overdueDays: number;
  escalate: boolean;
}

export function selectDeadlineAction(
  task: DeadlineTaskLike,
  today: string,
  reminderDaysBefore: number,
  escalationOverdueDays: number,
): DeadlineSelection | null {
  if (!task.dueDate || !task.assigneeId || task.status === 'DONE' || task.status === 'CANCELLED') return null;
  const dueTime = Date.parse(`${task.dueDate}T00:00:00Z`);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(dueTime) || !Number.isFinite(todayTime)) return null;
  const overdueDays = Math.max(0, Math.floor((todayTime - dueTime) / 86_400_000));
  const overdue = task.dueDate < today;
  const withinReminderWindow = !overdue && dueTime - todayTime <= reminderDaysBefore * 86_400_000;
  return {
    sendReminder: overdue || withinReminderWindow,
    overdueDays,
    escalate: overdue && (overdueDays >= escalationOverdueDays || task.priority === 'HIGH' || task.priority === 'CRITICAL'),
  };
}

export interface ReportTaskLike {
  id: string;
  title: string;
  status?: TaskStatusValue | null;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export function reportNumbers(tasks: readonly ReportTaskLike[], today: string) {
  const active = tasks.filter((task) => task.status !== 'CANCELLED');
  const completed = active.filter((task) => task.status === 'DONE').length;
  const inProgress = active.filter((task) => task.status === 'IN_PROGRESS').length;
  const overdue = active.filter((task) => task.status !== 'DONE' && !!task.dueDate && task.dueDate < today);
  const blocked = active.filter((task) => task.status === 'BLOCKED');
  return {
    total: active.length,
    completed,
    inProgress,
    overdue,
    blocked,
    overdueCount: overdue.length,
    completionRate: active.length ? Math.round((completed / active.length) * 100) : 0,
  };
}

function isoThursday(date: Date): Date {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  return utc;
}

export function isoWeekYear(date: Date): number {
  return isoThursday(date).getUTCFullYear();
}

export function isoWeekNumber(date: Date): number {
  const utc = isoThursday(date);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}
