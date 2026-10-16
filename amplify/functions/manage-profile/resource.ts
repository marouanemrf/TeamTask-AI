import { defineFunction } from '@aws-amplify/backend';
export const manageProfileFunction = defineFunction({ name: 'manage-profile', entry: './handler.ts', runtime: 20, timeoutSeconds: 20, resourceGroupName: 'data' });
