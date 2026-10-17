import { defineFunction, secret } from '@aws-amplify/backend';

/** Steps of the AI plan approval state machine (generate, wait for decision, apply, expire, fail). */
export const planWorkflowFunction = defineFunction({
  name: 'plan-workflow',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 180,
  memoryMB: 512,
  // Same stack as the data API (it reads and writes the models) and the state machine.
  resourceGroupName: 'data',
  environment: {
    SENDER_EMAIL: secret('SENDER_EMAIL'),
    APP_URL: secret('APP_URL'),
  },
});
