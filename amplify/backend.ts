import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { assignTaskFunction } from './functions/assign-task/resource';
import { cancelTaskFunction } from './functions/cancel-task/resource';
import { changeTaskStatusFunction } from './functions/change-task-status/resource';
import { createTaskFunction } from './functions/create-task/resource';
import { deadlineCheckFunction } from './functions/deadline-check/resource';
import { logEventFunction } from './functions/log-event/resource';
import { resolveEscalationFunction } from './functions/resolve-escalation/resource';
import { updateTaskFunction } from './functions/update-task/resource';
import { weeklyReportFunction } from './functions/weekly-report/resource';
import { manageTeamMemberFunction } from './functions/manage-team-member/resource';
import { manageProfileFunction } from './functions/manage-profile/resource';
import { presenceFunction } from './functions/presence/resource';
import { assistantChatFunction } from './functions/assistant-chat/resource';
import { assistantToolsFunction } from './functions/assistant-tools/resource';
import { DEFAULT_ASSISTANT_MODEL, defineAssistant } from './custom/assistant/resource';
import { storage } from './storage/resource';

/**
 * TeamTask AI backend: Cognito auth + AppSync/DynamoDB data + S3 storage (profile pictures)
 * + Lambda task API (business rules, idempotency and audit enforced server-side).
 * @see https://docs.amplify.aws/react/build-a-backend/
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  createTaskFunction,
  updateTaskFunction,
  changeTaskStatusFunction,
  assignTaskFunction,
  cancelTaskFunction,
  logEventFunction,
  deadlineCheckFunction,
  weeklyReportFunction,
  resolveEscalationFunction,
  manageTeamMemberFunction,
  manageProfileFunction,
  presenceFunction,
  assistantChatFunction,
  assistantToolsFunction,
});

// Internal tool: disable self sign-up. Accounts are created by an administrator only.
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// The task functions identify the caller by email. AppSync forwards the access token, which has
// no email claim, so they read it from the user pool: read-only AdminGetUser on this pool only.
const userPool = backend.auth.resources.userPool;
for (const fn of [
  backend.createTaskFunction,
  backend.updateTaskFunction,
  backend.changeTaskStatusFunction,
  backend.assignTaskFunction,
  backend.cancelTaskFunction,
  backend.logEventFunction,
  backend.weeklyReportFunction,
  backend.resolveEscalationFunction,
  backend.manageProfileFunction,
  backend.presenceFunction,
]) {
  fn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({ actions: ['cognito-idp:AdminGetUser'], resources: [userPool.userPoolArn] }),
  );
}
backend.manageTeamMemberFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.manageTeamMemberFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser', 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup'],
  resources: [userPool.userPoolArn],
}));

// Self-service profile photos. A user in a Cognito group assumes the group's IAM role, which the
// storage rule allow.entity('identity') does not reach: give every group role the same
// "own folder only" write access the authenticated role has (identity id from the session).
// The policy lives in the storage stack, like Amplify's own storage policies, so the auth stack
// never references the bucket (that would make the two nested stacks depend on each other).
const avatarsBucket = backend.storage.resources.bucket;
new Policy(Stack.of(avatarsBucket), 'GroupOwnProfilePhotoPolicy', {
  statements: [
    new PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [`${avatarsBucket.bucketArn}/profile-avatars/` + '${cognito-identity.amazonaws.com:sub}/*'],
    }),
  ],
  roles: (['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const).map((group) => backend.auth.resources.groups[group].role),
});

// Email settings are Amplify secrets (SSM Parameter Store SecureString, read by the functions at
// start-up), never code. Set them per deployment before the first deploy:
//   sandbox:  npx ampx sandbox secret set SENDER_EMAIL   /   npx ampx sandbox secret set APP_URL
//   branch:   Amplify console → Hosting → Secrets (SENDER_EMAIL, APP_URL = https://<branch>.<appId>.amplifyapp.com)
// SES is limited to sending from verified identities of this account and region.
for (const fn of [backend.deadlineCheckFunction, backend.weeklyReportFunction]) {
  const fnStack = Stack.of(fn.resources.lambda);
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: [`arn:aws:ses:${fnStack.region}:${fnStack.account}:identity/*`],
  }));
}

// TeamTask assistant for all users (amplify/custom/assistant): Bedrock Agent + guardrail, tools
// Lambda (read-only, organisation-scoped), POST /assistant/chat on API Gateway (Cognito authorizer).
// ASSISTANT_MODEL_ID switches the model without code changes (e.g. an Amazon Nova profile).
// Allowed browser origins: the Amplify Hosting URL of the branch being built, or local dev for the sandbox.
const hostingOrigin = process.env.AWS_BRANCH && process.env.AWS_APP_ID ? `https://${process.env.AWS_BRANCH}.${process.env.AWS_APP_ID}.amplifyapp.com` : undefined;
const assistant = defineAssistant({
  toolsFunction: backend.assistantToolsFunction.resources.lambda,
  chatFunction: backend.assistantChatFunction.resources.lambda,
  userPool: backend.auth.resources.userPool,
  tables: backend.data.resources.tables,
  deployment: process.env.AWS_BRANCH ?? 'sandbox',
  allowedOrigins: hostingOrigin ? [hostingOrigin] : ['http://localhost:5173', 'http://localhost:4173'],
  modelId: process.env.ASSISTANT_MODEL_ID ?? DEFAULT_ASSISTANT_MODEL,
});
for (const [key, value] of Object.entries(assistant.toolsEnv)) backend.assistantToolsFunction.addEnvironment(key, value);
for (const [key, value] of Object.entries(assistant.chatEnv)) backend.assistantChatFunction.addEnvironment(key, value);
backend.addOutput({ custom: { teamtaskApi: { url: assistant.api.url } } });
