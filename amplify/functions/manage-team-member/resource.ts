import { defineFunction } from '@aws-amplify/backend';
export const manageTeamMemberFunction = defineFunction({ name: 'manage-team-member', entry: './handler.ts', runtime: 20, timeoutSeconds: 30, resourceGroupName: 'data' });
