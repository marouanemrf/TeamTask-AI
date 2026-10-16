import { defineFunction } from '@aws-amplify/backend';

/** Moves a task to another status, enforcing permissions and dependency rules. */
export const changeTaskStatusFunction = defineFunction({
  name: 'change-task-status',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
