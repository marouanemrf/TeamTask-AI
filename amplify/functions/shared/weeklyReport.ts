import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Schema } from '../../data/resource';
import type { DataClient } from './data';
import { check } from './data';
import { isDuplicateWrite } from './audit';
import { isoWeekNumber, isoWeekYear, reportNumbers } from './automationRules';
import { projectUrl, renderEmail } from './emailTemplates';
import { askModel } from './aiModel';
import { postToChat } from './notify';
import { parseWeeklyAnswer, WEEKLY_SYSTEM_PROMPT, weeklyPrompt } from './weeklyAi';
import type { WeeklyFacts } from './weeklyAi';

const PAGE_SIZE = 500;

async function listProjectTasks(client: DataClient, projectId: string): Promise<Schema['Task']['type'][]> {
  const items: Schema['Task']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Task.list({ filter: { projectId: { eq: projectId } }, nextToken, limit: PAGE_SIZE });
    items.push(...check(page, 'Task.list'));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

/** One report per project per ISO week: its id is derived from both, so a second create fails. */
const reportId = (projectId: string, year: number, weekNumber: number) => `${projectId}:${year}-W${String(weekNumber).padStart(2, '0')}`;

async function existingReport(client: DataClient, projectId: string, year: number, weekNumber: number) {
  return check(await client.models.WeeklyReport.get({ id: reportId(projectId, year, weekNumber) }), 'WeeklyReport.get');
}

export async function generateProjectReport(client: DataClient, ses: SESv2Client, appUrl: string, sender: string, project: Schema['Project']['type'], now = new Date()) {
  const year = isoWeekYear(now);
  const weekNumber = isoWeekNumber(now);
  const prior = await existingReport(client, project.id, year, weekNumber);
  if (prior) return prior;

  const today = now.toISOString().slice(0, 10);
  const tasks = await listProjectTasks(client, project.id);
  const numbers = reportNumbers(tasks, today);
  const taskIds = new Set(tasks.map((task) => task.id));
  const dependencies: Schema['Dependency']['type'][] = [];
  let depToken: string | null | undefined;
  do {
    const page = await client.models.Dependency.list({ nextToken: depToken, limit: PAGE_SIZE });
    dependencies.push(...check(page, 'Dependency.list').filter((d) => taskIds.has(d.fromTaskId) || taskIds.has(d.toTaskId)));
    depToken = page.nextToken;
  } while (depToken);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const blockers = new Set(dependencies.map((d) => d.toTaskId));
  const risks: string[] = [];
  for (const task of numbers.overdue) {
    const blockedTitles = dependencies.filter((d) => d.toTaskId === task.id).map((d) => taskById.get(d.fromTaskId)?.title).filter((v): v is string => !!v);
    risks.push(`Overdue: ${task.title}${blockers.has(task.id) ? ` (blocks: ${blockedTitles.join(', ')})` : ''}.`);
  }

  const events: Schema['TaskEvent']['type'][] = [];
  let eventToken: string | null | undefined;
  do {
    const eventPage = await client.models.TaskEvent.list({ filter: { eventType: { eq: 'STATUS_CHANGED' } }, nextToken: eventToken, limit: PAGE_SIZE });
    events.push(...check(eventPage, 'TaskEvent.list'));
    eventToken = eventPage.nextToken;
  } while (eventToken);
  for (const task of numbers.blocked) {
    const latest = events.filter((e) => e.entityId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    let reason = '';
    try {
      const after = JSON.parse(String(latest?.after ?? '{}')) as { reason?: string };
      reason = after.reason ?? '';
    } catch { /* malformed legacy event */ }
    const blockedTitles = dependencies.filter((d) => d.toTaskId === task.id).map((d) => taskById.get(d.fromTaskId)?.title).filter((v): v is string => !!v);
    risks.push(`Blocked: ${task.title}${reason ? ` — ${reason}` : ''}${blockers.has(task.id) ? ` (blocks: ${blockedTitles.join(', ')})` : ''}.`);
  }

  const byMember = new Map<string, Schema['Task']['type'][]>();
  for (const task of tasks.filter((t) => t.assigneeId && t.status !== 'DONE' && t.status !== 'CANCELLED')) {
    const memberTasks = byMember.get(task.assigneeId!) ?? [];
    memberTasks.push(task);
    byMember.set(task.assigneeId!, memberTasks);
  }
  const correctiveActions: string[] = [];
  const memberNames = new Map<string, string>();
  const overloaded: WeeklyFacts['overloaded'] = [];
  const available: WeeklyFacts['available'] = [];
  for (const [memberId, assigned] of byMember) {
    const member = check(await client.models.TeamMember.get({ id: memberId }), 'TeamMember.get');
    const capacity = member?.weeklyCapacityHours ?? 40;
    const hours = assigned.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
    const percent = capacity > 0 ? Math.round((hours / capacity) * 100) : 0;
    if (member) memberNames.set(memberId, member.name);
    if (percent > 100 && member) {
      correctiveActions.push(`Reassign “${assigned[0].title}”: ${member.name} is at ${percent}% workload.`);
      overloaded.push({ name: member.name, percent });
    } else if (member && percent < 70) available.push({ name: member.name, percent });
  }

  let summary = `Week ${weekNumber}: ${numbers.completed} of ${numbers.total} task(s) done (${numbers.completionRate}%), ${numbers.inProgress} in progress, ${numbers.overdueCount} overdue and ${numbers.blocked.length} blocked.`;
  let actions = correctiveActions;
  let aiGenerated = false;
  // The AI writes the summary and proposes actions from the facts above; the rule-based text stays
  // when the model is not configured, fails, or its answer doesn't quote the real numbers.
  if (process.env.MODEL_ID && numbers.total > 0) {
    const facts: WeeklyFacts = {
      project: project.name,
      week: `${year}-W${String(weekNumber).padStart(2, '0')}`,
      total: numbers.total,
      completed: numbers.completed,
      inProgress: numbers.inProgress,
      overdue: numbers.overdueCount,
      blocked: numbers.blocked.length,
      completionRate: numbers.completionRate,
      risks,
      overloaded,
      available,
      openTasks: tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').map((t) => ({ title: t.title, dueDate: t.dueDate ?? null, owner: t.assigneeId ? memberNames.get(t.assigneeId) ?? null : null, status: t.status ?? 'TODO' })),
    };
    try {
      const answer = await askModel(WEEKLY_SYSTEM_PROMPT, weeklyPrompt(facts), 1200, 0.2);
      const parsed = answer.stopReason === 'guardrail_intervened' ? null : parseWeeklyAnswer(answer.text, facts);
      console.info(JSON.stringify({ fn: 'weekly-report', projectId: project.id, ai: parsed ? 'USED' : 'REJECTED', stopReason: answer.stopReason, outputTokens: answer.outputTokens }));
      if (parsed) {
        summary = parsed.summary;
        actions = parsed.correctiveActions.length ? parsed.correctiveActions : correctiveActions;
        aiGenerated = true;
      }
    } catch (error) {
      console.warn(JSON.stringify({ fn: 'weekly-report', projectId: project.id, ai: 'ERROR', error: error instanceof Error ? error.name : String(error) }));
    }
  }
  const created = await client.models.WeeklyReport.create({
    id: reportId(project.id, year, weekNumber),
    projectId: project.id,
    year,
    weekNumber,
    totalCount: numbers.total,
    completedCount: numbers.completed,
    inProgressCount: numbers.inProgress,
    overdueCount: numbers.overdueCount,
    completionRate: numbers.completionRate,
    summary,
    risks,
    correctiveActions: actions,
    aiGenerated,
  });
  // A concurrent run (schedule + manual) created it first: return that one, send nothing.
  if (isDuplicateWrite(created.errors)) return (await existingReport(client, project.id, year, weekNumber))!;
  const report = check(created, 'WeeklyReport.create');
  if (!report) throw new Error('WeeklyReport.create returned no data');

  if (project.managerEmail) {
    const content = renderEmail({ subject: `Weekly report: ${project.name}`, heading: `Weekly report · ${project.name}`, body: `${summary}\n\nRisks:\n${risks.length ? risks.map((risk) => `• ${risk}`).join('\n') : 'No risks reported.'}\n\nSuggested actions${aiGenerated ? ' (AI)' : ''}:\n${actions.length ? actions.map((action) => `• ${action}`).join('\n') : 'No actions suggested.'}`, link: projectUrl(appUrl, project.id), linkLabel: 'Open the project' });
    try {
      await ses.send(new SendEmailCommand({ FromEmailAddress: sender, Destination: { ToAddresses: [project.managerEmail] }, Content: { Simple: { Subject: { Data: `Weekly report: ${project.name}`, Charset: 'UTF-8' }, Body: { Html: { Data: content.html, Charset: 'UTF-8' }, Text: { Data: content.text, Charset: 'UTF-8' } } } } }));
    } catch (error) {
      console.error(JSON.stringify({ fn: 'weekly-report', projectId: project.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  await postToChat(`Weekly report · ${project.name}: ${summary}`, { url: projectUrl(appUrl, project.id), label: 'Open the project' });
  return report;
}
