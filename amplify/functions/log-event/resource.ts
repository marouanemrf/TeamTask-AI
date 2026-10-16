import { defineFunction } from '@aws-amplify/backend';

/** Records audit events for non-task records (projects, members, milestones). */
export const logEventFunction = defineFunction({
  name: 'log-event',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
