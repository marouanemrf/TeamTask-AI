import { describe, expect, it } from 'vitest';
import type { Dependency, Project, Task } from '../services/client';
import { projectPriority, taskPriority } from './eisenhower';

const project = (fields: Partial<Project> = {}) => ({ id: 'p1', name: 'Project', status: 'ACTIVE', businessImpact: 'CRITICAL', startDate: '2026-10-01', endDate: '2026-12-01', ...fields }) as Project;
const task = (fields: Partial<Task> = {}) => ({ id: 't1', projectId: 'p1', title: 'Task', status: 'TODO', ...fields }) as Task;

describe('projectPriority', () => {
  it('raises urgency for overdue work and places critical work in Do First', () => {
    const result = projectPriority(project({ endDate: '2026-10-13' }), [task({ dueDate: '2026-10-14' })], [], '2026-10-15');
    expect(result.daysLate).toBe(2);
    expect(result.quadrant).toBe('DO_FIRST');
    expect(result.overdueTasks).toBe(1);
  });
  it('counts unfinished dependencies as blocked signals', () => {
    const result = projectPriority(project({ endDate: '2026-12-01' }), [task(), task({ id: 't2', title: 'Dependency' })], [{ fromTaskId: 't1', toTaskId: 't2' } as Dependency], '2026-10-15');
    expect(result.blockedTasks).toBe(1);
    expect(result.urgency).toBeGreaterThanOrEqual(4);
  });
  it('keeps projects out of quadrants when importance or deadlines are unknown', () => {
    const result = projectPriority(project({ businessImpact: null, endDate: null }), [], [], '2026-10-15');
    expect(result.importance).toBeNull();
    expect(result.urgency).toBeNull();
    expect(result.quadrant).toBeNull();
  });
  it('honors authorized 1–5 priority overrides', () => {
    const result = projectPriority(project({ importanceOverride: 2, urgencyOverride: 5 }), [], [], '2026-10-15');
    expect(result.quadrant).toBe('DELEGATE');
  });
});

describe('taskPriority', () => {
  const byId = (...tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]));
  const today = '2026-10-15';

  it('raises urgency as the due date approaches', () => {
    const urgency = (dueDate: string) => taskPriority(task({ dueDate, priority: 'HIGH' }), project(), [], byId(), today).urgency;
    expect(urgency('2026-12-30')).toBe(1);
    expect(urgency('2026-11-01')).toBe(3);
    expect(urgency('2026-10-20')).toBe(4);
    expect(urgency('2026-10-14')).toBe(5);
  });
  it('combines business impact and task priority into importance, keeping both visible', () => {
    const critical = taskPriority(task({ dueDate: '2026-10-16', priority: 'MEDIUM' }), project({ businessImpact: 'CRITICAL' }), [], byId(), today);
    expect(critical.businessImpact).toBe(5);
    expect(critical.importance).toBe(4);
    expect(critical.quadrant).toBe('DO_FIRST');
    expect(critical.reasons).toEqual(expect.arrayContaining(['business impact critical', 'task priority medium']));
    const low = taskPriority(task({ dueDate: '2026-10-16', priority: 'MEDIUM' }), project({ businessImpact: 'LOW' }), [], byId(), today);
    expect(low.quadrant).toBe('DELEGATE');
  });
  it('reflects a business impact change', () => {
    const t = task({ dueDate: '2026-12-30', priority: 'MEDIUM' });
    expect(taskPriority(t, project({ businessImpact: 'LOW' }), [], byId(), today).quadrant).toBe('DEPRIORITIZE');
    expect(taskPriority(t, project({ businessImpact: 'CRITICAL' }), [], byId(), today).quadrant).toBe('SCHEDULE');
  });
  it('treats unfinished dependencies as urgent blocked work', () => {
    const dep = task({ id: 't2', status: 'IN_PROGRESS' });
    const result = taskPriority(task({ priority: 'HIGH' }), project(), [{ fromTaskId: 't1', toTaskId: 't2' } as Dependency], byId(dep), today);
    expect(result.blocked).toBe(true);
    expect(result.urgency).toBe(4);
  });
  it('never treats missing data as urgent or important', () => {
    const result = taskPriority(task({ priority: null }), project({ businessImpact: null }), [], byId(), today);
    expect(result.urgency).toBeNull();
    expect(result.importance).toBeNull();
    expect(result.quadrant).toBeNull();
  });
});
