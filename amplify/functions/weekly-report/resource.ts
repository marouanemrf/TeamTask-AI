import { defineFunction } from '@aws-amplify/backend';

export const weeklyReportFunction = defineFunction({
  name: 'weekly-report',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 120,
  schedule: '0 15 ? * 6 *',
  resourceGroupName: 'data',
  environment: {
    // SENDER_EMAIL and APP_URL come from SSM Parameter Store (see amplify/backend.ts).
  },
});
