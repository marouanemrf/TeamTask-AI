import { defineFunction, secret } from '@aws-amplify/backend';

export const deadlineCheckFunction = defineFunction({
  name: 'deadline-check',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 120,
  schedule: '0 7 * * ? *',
  resourceGroupName: 'data',
  environment: {
    // Amplify secrets (SSM Parameter Store), set per deployment — see amplify/backend.ts.
    SENDER_EMAIL: secret('SENDER_EMAIL'),
    APP_URL: secret('APP_URL'),
    REMINDER_DAYS_BEFORE: '2',
    ESCALATION_OVERDUE_DAYS: '2',
  },
});
