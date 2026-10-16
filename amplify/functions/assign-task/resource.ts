import { defineFunction } from '@aws-amplify/backend';

/** Changes a task's assignee (managers) and logs ASSIGNED. */
export const assignTaskFunction = defineFunction({
  name: 'assign-task',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
