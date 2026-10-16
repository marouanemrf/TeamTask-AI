import { defineFunction } from '@aws-amplify/backend';

/** Creates a task with validation, dependencies and a CREATED audit event. */
export const createTaskFunction = defineFunction({
  name: 'create-task',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
