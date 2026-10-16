import { defineFunction } from '@aws-amplify/backend';

export const deadlineCheckFunction = defineFunction({
  name: 'deadline-check',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 120,
  schedule: '0 7 * * ? *',
  resourceGroupName: 'data',
  environment: {
    // SENDER_EMAIL and APP_URL come from SSM Parameter Store (see amplify/backend.ts).
    REMINDER_DAYS_BEFORE: '2',
    ESCALATION_OVERDUE_DAYS: '2',
  },
});
