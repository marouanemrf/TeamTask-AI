import { defineFunction } from '@aws-amplify/backend';

/** Edits a task's fields and dependencies (managers), with audit events. */
export const updateTaskFunction = defineFunction({
  name: 'update-task',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
