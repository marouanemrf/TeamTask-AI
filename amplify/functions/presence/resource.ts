import { defineFunction } from '@aws-amplify/backend';
export const presenceFunction = defineFunction({ name: 'presence', entry: './handler.ts', runtime: 20, timeoutSeconds: 15, resourceGroupName: 'data' });
