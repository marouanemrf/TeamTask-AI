import { defineFunction } from '@aws-amplify/backend';

/** POST /assistant/chat: identity from the Cognito authorizer, rate limit, streamed answer (Bedrock Converse + tools). */
export const assistantChatFunction = defineFunction({
  name: 'assistant-chat',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 120,
  memoryMB: 512,
  resourceGroupName: 'assistant',
});
