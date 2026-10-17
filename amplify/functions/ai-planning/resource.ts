import { defineFunction } from '@aws-amplify/backend';

/** requestProjectPlan / decideRecommendation: starts the plan approval workflow and records decisions. */
export const aiPlanningFunction = defineFunction({
  name: 'ai-planning',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
