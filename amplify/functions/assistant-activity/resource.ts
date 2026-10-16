import { defineFunction } from '@aws-amplify/backend';

/** GET /assistant/executions: recorded assistant executions (own; whole organisation for ADMIN). */
export const assistantActivityFunction = defineFunction({
  name: 'assistant-activity',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  resourceGroupName: 'assistant',
});
