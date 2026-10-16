import { env } from '$amplify/env/deadline-check';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Schema } from '../../data/resource';
import { createDataClient, check } from '../shared/data';
import { projectUrl, renderEmail, taskUrl } from '../shared/emailTemplates';
import { selectDeadlineAction } from '../shared/automationRules';
import { config } from '../shared/config';

const client = await createDataClient(env);
const ses = new SESv2Client({ region: 'eu-north-1' });
const PAGE_SIZE = 500;

async function allTasks(): Promise<Schema['Task']['type'][]> {
  const items: Schema['Task']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Task.list({ nextToken, limit: PAGE_SIZE });
    items.push(...check(page, 'Task.list'));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

async function allDependencies() {
  const items: Schema['Dependency']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Dependency.list({ nextToken, limit: PAGE_SIZE });
    items.push(...check(page, 'Dependency.list'));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

async function reminderExists(taskId: string, recipientEmail: string, today: string): Promise<boolean> {
  const start = `${today}T00:00:00.000Z`;
  const end = `${today}T23:59:59.999Z`;
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Reminder.list({ filter: { taskId: { eq: taskId } }, nextToken, limit: PAGE_SIZE });
    const reminders = check(page, 'Reminder.list');
    if (reminders.some((r) => r.recipientEmail.toLowerCase() === recipientEmail.toLowerCase() && (r.scheduledAt ?? '') >= start && (r.scheduledAt ?? '') <= end)) return true;
    nextToken = page.nextToken;
  } while (nextToken);
  return false;
}

async function sendAndRecord(taskId: string, recipientEmail: string, subject: string, heading: string, body: string, link: string, linkLabel: string) {
  const now = new Date();
  const content = renderEmail({ subject, heading, body, link, linkLabel });
  let status: 'SENT' | 'FAILED' = 'SENT';
  let sentAt: string | null = now.toISOString();
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: config('SENDER_EMAIL'),
      Destination: { ToAddresses: [recipientEmail] },
      Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: content.html, Charset: 'UTF-8' }, Text: { Data: content.text, Charset: 'UTF-8' } } } },
    }));
  } catch (error) {
    status = 'FAILED';
    sentAt = null;
    console.error(JSON.stringify({ fn: 'deadline-check', taskId, recipientEmail, error: error instanceof Error ? error.message : String(error) }));
  }
  check(await client.models.Reminder.create({ taskId, recipientEmail, channel: 'EMAIL', scheduledAt: now.toISOString(), sentAt, status }), 'Reminder.create');
  return status === 'SENT';
}

export const handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const reminderDays = Number(env.REMINDER_DAYS_BEFORE || 2);
  const escalationDays = Number(env.ESCALATION_OVERDUE_DAYS || 2);
  const [tasks, dependencies] = await Promise.all([allTasks(), allDependencies()]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const appUrl = config('APP_URL');

  for (const task of tasks) {
    try {
      const action = selectDeadlineAction(task, today, reminderDays, escalationDays);
      if (!action) continue;
      const member = check(await client.models.TeamMember.get({ id: task.assigneeId! }), 'TeamMember.get');
      const project = check(await client.models.Project.get({ id: task.projectId }), 'Project.get');
      if (!project) continue;

      if (member?.email && action.sendReminder && !(await reminderExists(task.id, member.email, today))) {
        const isOverdue = action.overdueDays > 0;
        const when = isOverdue ? `${action.overdueDays} day(s) overdue` : `due on ${task.dueDate}`;
        await sendAndRecord(task.id, member.email, `Reminder: ${task.title}`, `Task reminder`, `The task “${task.title}” is ${when}.`, taskUrl(appUrl, project.id, task.id), 'Open the project');
      }

      if (!action.escalate) continue;
      let nextToken: string | null | undefined;
      let open = false;
      do {
        const page = await client.models.Escalation.list({ filter: { taskId: { eq: task.id }, status: { eq: 'OPEN' } }, nextToken, limit: PAGE_SIZE });
        if (check(page, 'Escalation.list').length) open = true;
        nextToken = page.nextToken;
      } while (nextToken && !open);
      if (open) continue;

      const impacted = dependencies.filter((edge) => edge.toTaskId === task.id).map((edge) => taskById.get(edge.fromTaskId)?.title).filter((title): title is string => !!title);
      const impactText = impacted.length ? `Blocked tasks: ${impacted.join(', ')}.` : 'No dependent tasks found.';
      const reason = `${action.overdueDays} day(s) overdue. ${impactText}`;
      const escalation = check(await client.models.Escalation.create({ taskId: task.id, status: 'OPEN', level: 1, reason }), 'Escalation.create');
      if (!escalation) throw new Error('Escalation.create returned no data');
      check(await client.models.TaskEvent.create({ entityId: task.id, eventType: 'ESCALATED', actorType: 'SYSTEM', actorEmail: env.SENDER_EMAIL, after: JSON.stringify({ escalationId: escalation.id, reason, impacted }) }), 'TaskEvent.create');
      if (project.managerEmail) {
        await sendAndRecord(task.id, project.managerEmail, `Escalation: ${task.title}`, 'A task needs your attention', `“${task.title}” is ${action.overdueDays} day(s) overdue. ${impactText}`, projectUrl(appUrl, project.id), 'Ouvrir le projet');
      }
    } catch (error) {
      console.error(JSON.stringify({ fn: 'deadline-check', taskId: task.id, error: error instanceof Error ? error.stack : String(error) }));
    }
  }
};
