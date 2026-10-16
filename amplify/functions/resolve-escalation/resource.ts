import { defineFunction } from '@aws-amplify/backend';

export const resolveEscalationFunction = defineFunction({
  name: 'resolve-escalation',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
