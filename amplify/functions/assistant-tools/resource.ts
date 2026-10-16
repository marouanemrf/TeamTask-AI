import { defineFunction } from '@aws-amplify/backend';

/** Tools of the TeamTask assistant, called by assistant-chat. Read-only on the app tables. */
export const assistantToolsFunction = defineFunction({
  name: 'assistant-tools',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
  // Same nested stack as the chat function, API and assistant table (amplify/custom/assistant).
  resourceGroupName: 'assistant',
});
