import { defineFunction } from '@aws-amplify/backend';

/** Copies every audit event (TaskEvent stream) to the Object Lock archive bucket. */
export const auditArchiveFunction = defineFunction({
  name: 'audit-archive',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 60,
  // Own stack with the other operations resources (amplify/custom/operations).
  resourceGroupName: 'operations',
});
