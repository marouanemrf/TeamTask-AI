import { defineFunction } from '@aws-amplify/backend';

/** POST /profile/career-suggestions: AI career suggestions from the caller's own profile (Bedrock). */
export const careerSuggestionsFunction = defineFunction({
  name: 'career-suggestions',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 60,
  memoryMB: 512,
  resourceGroupName: 'assistant',
});
