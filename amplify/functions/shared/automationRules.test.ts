import { describe, expect, it } from 'vitest';
import { isoWeekNumber, isoWeekYear, reportNumbers, selectDeadlineAction } from './automationRules';

describe('deadline reminder and escalation selection', () => {
  const base = { id: 'task-1', status: 'TODO' as const, dueDate: '2026-10-15', assigneeId: 'member-1', priority: 'MEDIUM' };
  it('reminds tasks due within the configured window but does not escalate', () => {
    expect(selectDeadlineAction(base, '2026-10-14', 2, 2)).toEqual({ sendReminder: true, overdueDays: 0, escalate: false });
  });
  it('reminds overdue tasks daily and escalates after the overdue threshold', () => {
    expect(selectDeadlineAction({ ...base, dueDate: '2026-10-12' }, '2026-10-14', 2, 2)).toMatchObject({ sendReminder: true, overdueDays: 2, escalate: true });
  });
  it('escalates overdue HIGH/CRITICAL tasks before the day threshold', () => {
    expect(selectDeadlineAction({ ...base, dueDate: '2026-10-13', priority: 'HIGH' }, '2026-10-14', 2, 2)?.escalate).toBe(true);
  });
  it('ignores tasks without due dates or assignees and closed tasks', () => {
    expect(selectDeadlineAction({ ...base, dueDate: null }, '2026-10-14', 2, 2)).toBeNull();
    expect(selectDeadlineAction({ ...base, assigneeId: null }, '2026-10-14', 2, 2)).toBeNull();
    expect(selectDeadlineAction({ ...base, status: 'DONE' }, '2026-10-14', 2, 2)).toBeNull();
  });
});

describe('weekly report numbers', () => {
  it('counts active, completed, in progress, overdue and blocked tasks correctly', () => {
    const result = reportNumbers([
      { id: 'a', title: 'Done', status: 'DONE', dueDate: '2026-10-10' },
      { id: 'b', title: 'Late', status: 'TODO', dueDate: '2026-10-13' },
      { id: 'c', title: 'Blocked', status: 'BLOCKED', dueDate: '2026-10-20' },
      { id: 'd', title: 'Progress', status: 'IN_PROGRESS' },
      { id: 'e', title: 'Cancelled', status: 'CANCELLED', dueDate: '2026-10-01' },
    ], '2026-10-15');
    expect(result).toMatchObject({ total: 4, completed: 1, inProgress: 1, overdueCount: 1, completionRate: 25 });
    expect(result.overdue.map((task) => task.id)).toEqual(['b']);
    expect(result.blocked.map((task) => task.id)).toEqual(['c']);
  });
  it('uses ISO week numbering', () => {
    expect(isoWeekNumber(new Date('2026-01-01T12:00:00Z'))).toBe(1);
    expect(isoWeekNumber(new Date('2026-12-31T12:00:00Z'))).toBe(53);
    expect(isoWeekNumber(new Date('2027-01-01T12:00:00Z'))).toBe(53);
    expect(isoWeekYear(new Date('2027-01-01T12:00:00Z'))).toBe(2026);
  });
});
