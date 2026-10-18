import { defineFunction } from '@aws-amplify/backend';

/** saveProject / addMilestone: projects and milestones of the caller's organisation (managers only), audited. */
export const manageProjectFunction = defineFunction({
  name: 'manage-project',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 20,
  // Same stack as the data API: it calls these functions and they call it back (avoids a stack cycle).
  resourceGroupName: 'data',
});
