import { env } from '$amplify/env/weekly-report';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { Schema } from '../../data/resource';
import { createDataClient, check } from '../shared/data';
import { fail } from '../shared/errors';
import { runMutation } from '../shared/handler';
import { generateProjectReport } from '../shared/weeklyReport';
import { config } from '../shared/config';
import { assertSameOrganisation, requireOrganisation } from '../shared/tenancy';

const client = await createDataClient(env);
const ses = new SESv2Client({ region: 'eu-north-1' });

interface EventShape { arguments?: { projectId?: string }; identity?: unknown }

export const handler = async (rawEvent: EventShape) => {
  const appUrl = config('APP_URL');
  if (rawEvent?.identity) {
    return runMutation('generate-weekly-report', { identity: rawEvent.identity, arguments: rawEvent.arguments ?? {} }, async (caller, args) => {
      if (!caller.roles.includes('ADMIN')) fail('FORBIDDEN', 'Only administrators can generate a report manually.');
      const projectId = args.projectId;
      if (!projectId) fail('VALIDATION', 'The project is required.');
      const project = check(await client.models.Project.get({ id: projectId }), 'Project.get');
      assertSameOrganisation(project, requireOrganisation(caller), 'This project');
      if (!project) fail('NOT_FOUND', "This project doesn't exist.");
      return generateProjectReport(client, ses, appUrl, config('SENDER_EMAIL'), project);
    });
  }

  const projects: Schema['Project']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Project.list({ filter: { status: { eq: 'ACTIVE' } }, nextToken, limit: 500 });
    projects.push(...check(page, 'Project.list'));
    nextToken = page.nextToken;
  } while (nextToken);
  for (const project of projects) {
    try {
      await generateProjectReport(client, ses, appUrl, config('SENDER_EMAIL'), project);
    } catch (error) {
      console.error(JSON.stringify({ fn: 'weekly-report', projectId: project.id, error: error instanceof Error ? error.stack : String(error) }));
    }
  }
};
