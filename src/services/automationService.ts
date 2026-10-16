import { ApiError } from './apiError';
import { client } from './client';
import type { Escalation, Project, Task, TeamMember, WeeklyReport } from './client';

export interface EscalationView {
  escalation: Escalation;
  task: Task | null;
  project: Project | null;
  assignee: TeamMember | null;
  impactedTasks: Task[];
  daysLate: number;
}

/** Every page of a filtered list: a single call with `limit` applies the limit before the filter. */
async function listAll<T>(load: (nextToken: string | null | undefined) => Promise<{ data: T[]; errors?: readonly { message: string }[]; nextToken?: string | null }>, what: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await load(nextToken);
    if (page.errors?.length) throw ApiError.from(page.errors as never, what);
    items.push(...page.data);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

export async function listOpenEscalations(): Promise<EscalationView[]> {
  const escalations = await listAll((nextToken) => client.models.Escalation.list({ filter: { status: { eq: 'OPEN' } }, nextToken }), 'Escalation load failed');
  const views = await Promise.all(escalations.map(async (escalation) => {
    const [taskResult, dependencies] = await Promise.all([
      client.models.Task.get({ id: escalation.taskId }),
      listAll((nextToken) => client.models.Dependency.list({ filter: { toTaskId: { eq: escalation.taskId } }, nextToken }), 'Dependency load failed'),
    ]);
    if (taskResult.errors?.length) throw ApiError.from(taskResult.errors, 'Task load failed');
    const task = taskResult.data;
    const [projectResult, assigneeResult, impactedResults] = await Promise.all([
      task ? client.models.Project.get({ id: task.projectId }) : Promise.resolve({ data: null, errors: undefined }),
      task?.assigneeId ? client.models.TeamMember.get({ id: task.assigneeId }) : Promise.resolve({ data: null, errors: undefined }),
      Promise.all(dependencies.map((dependency) => client.models.Task.get({ id: dependency.fromTaskId }))),
    ]);
    const impactedTasks = impactedResults.flatMap((result) => result.data ? [result.data] : []);
    return {
      escalation,
      task,
      project: projectResult.data,
      assignee: assigneeResult.data,
      impactedTasks,
      daysLate: task?.dueDate ? Math.max(0, Math.floor((Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${task.dueDate}T00:00:00Z`)) / 86400000)) : 0,
    };
  }));
  return views.sort((a, b) => (a.task?.dueDate ?? '').localeCompare(b.task?.dueDate ?? ''));
}

export function observeOpenEscalationCount(onCount: (count: number) => void, onError: (error: unknown) => void): () => void {
  const sub = client.models.Escalation.observeQuery({ filter: { status: { eq: 'OPEN' } } }).subscribe({
    next: ({ items }) => onCount(items.length),
    error: onError,
  });
  return () => sub.unsubscribe();
}

export function observeProjectReports(projectId: string, onReports: (reports: WeeklyReport[]) => void, onError: (error: unknown) => void): () => void {
  const sub = client.models.WeeklyReport.observeQuery({ filter: { projectId: { eq: projectId } } }).subscribe({
    next: ({ items }) => onReports([...items].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.weekNumber - a.weekNumber)),
    error: onError,
  });
  return () => sub.unsubscribe();
}

export async function resolveEscalation(input: {
  escalationId: string;
  decision: 'REASSIGN' | 'EXTEND_DEADLINE' | 'ACCEPT_DELAY';
  comment?: string;
  newAssigneeEmail?: string;
  newDueDate?: string;
}): Promise<Escalation> {
  const { data, errors } = await client.mutations.resolveEscalation({ clientRequestId: crypto.randomUUID(), ...input });
  if (errors?.length || !data) throw ApiError.from(errors, 'Escalation resolution failed');
  return data;
}

export async function generateWeeklyReport(projectId: string): Promise<WeeklyReport> {
  const { data, errors } = await client.mutations.generateWeeklyReport({ projectId });
  if (errors?.length || !data) throw ApiError.from(errors, 'Report generation failed');
  return data;
}
