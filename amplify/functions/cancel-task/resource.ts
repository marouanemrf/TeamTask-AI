import { defineFunction } from '@aws-amplify/backend';

/** Cancels a task (status CANCELLED, never deleted). */
export const cancelTaskFunction = defineFunction({
  name: 'cancel-task',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
