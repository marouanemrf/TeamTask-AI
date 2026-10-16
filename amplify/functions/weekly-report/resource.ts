import { defineFunction, secret } from '@aws-amplify/backend';

export const weeklyReportFunction = defineFunction({
  name: 'weekly-report',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 120,
  schedule: '0 15 ? * 6 *',
  resourceGroupName: 'data',
  environment: {
    // Amplify secrets (SSM Parameter Store), set per deployment — see amplify/backend.ts.
    SENDER_EMAIL: secret('SENDER_EMAIL'),
    APP_URL: secret('APP_URL'),
  },
});
