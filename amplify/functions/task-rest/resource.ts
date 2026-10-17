import { defineFunction } from '@aws-amplify/backend';

/** REST task API on API Gateway (forwards to the task functions with the caller's token). */
export const taskRestFunction = defineFunction({
  name: 'task-rest',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  // Same stack as the REST API (amplify/custom/assistant).
  resourceGroupName: 'assistant',
});
