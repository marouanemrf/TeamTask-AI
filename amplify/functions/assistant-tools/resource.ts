import { defineFunction } from '@aws-amplify/backend';

/** Action group of the TeamTask assistant (Bedrock Agent). Read-only on the app tables. */
export const assistantToolsFunction = defineFunction({
  name: 'assistant-tools',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
  // Same nested stack as the agent, API and assistant table (amplify/custom/assistant).
  resourceGroupName: 'assistant',
});
