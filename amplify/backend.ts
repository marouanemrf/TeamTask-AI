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
import { assistantActivityFunction } from './functions/assistant-activity/resource';
import { careerSuggestionsFunction } from './functions/career-suggestions/resource';
import { aiPlanningFunction } from './functions/ai-planning/resource';
import { planWorkflowFunction } from './functions/plan-workflow/resource';
import { manageProjectFunction } from './functions/manage-project/resource';
import { defineWorkflows } from './custom/workflows/resource';
import { taskRestFunction } from './functions/task-rest/resource';
import { auditArchiveFunction } from './functions/audit-archive/resource';
import { defineSchedules } from './custom/schedules/resource';
import { defineOperations } from './custom/operations/resource';
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
  assistantActivityFunction,
  careerSuggestionsFunction,
  aiPlanningFunction,
  planWorkflowFunction,
  manageProjectFunction,
  taskRestFunction,
  auditArchiveFunction,
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
  backend.aiPlanningFunction,
  backend.manageProjectFunction,
]) {
  fn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({ actions: ['cognito-idp:AdminGetUser'], resources: [userPool.userPoolArn] }),
  );
}
// syncMyAccess: keeps each user's organisation groups in line with their role (see shared/tenancy.ts).
backend.manageProfileFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['cognito-idp:AdminListGroupsForUser', 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup', 'cognito-idp:CreateGroup'],
  resources: [userPool.userPoolArn],
}));
backend.manageTeamMemberFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.manageTeamMemberFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  // CreateGroup / ListGroupsForUser: the organisation groups that isolate each organisation's data.
  actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser', 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup', 'cognito-idp:AdminListGroupsForUser', 'cognito-idp:CreateGroup'],
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

// TeamTask assistant for all users (amplify/custom/assistant): Bedrock Converse + guardrail, tools
// Lambda (read-only, organisation-scoped), POST /assistant/chat on API Gateway (Cognito authorizer).
// ASSISTANT_MODEL_ID switches the model without code changes (e.g. an Amazon Nova profile).
// Allowed browser origins: the Amplify Hosting URL of the branch being built, or local dev for the sandbox.
const hostingOrigin = process.env.AWS_BRANCH && process.env.AWS_APP_ID ? `https://${process.env.AWS_BRANCH}.${process.env.AWS_APP_ID}.amplifyapp.com` : undefined;
const assistant = defineAssistant({
  toolsFunction: backend.assistantToolsFunction.resources.lambda,
  chatFunction: backend.assistantChatFunction.resources.lambda,
  careerFunction: backend.careerSuggestionsFunction.resources.lambda,
  activityFunction: backend.assistantActivityFunction.resources.lambda,
  taskRestFunction: backend.taskRestFunction.resources.lambda,
  graphqlUrl: backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl,
  userPool: backend.auth.resources.userPool,
  tables: backend.data.resources.tables,
  deployment: process.env.AWS_BRANCH ?? 'sandbox',
  allowedOrigins: hostingOrigin ? [hostingOrigin] : ['http://localhost:5173', 'http://localhost:4173'],
  modelId: process.env.ASSISTANT_MODEL_ID ?? DEFAULT_ASSISTANT_MODEL,
});
for (const [key, value] of Object.entries(assistant.toolsEnv)) backend.assistantToolsFunction.addEnvironment(key, value);
for (const [key, value] of Object.entries(assistant.chatEnv)) backend.assistantChatFunction.addEnvironment(key, value);
for (const [key, value] of Object.entries(assistant.careerEnv)) backend.careerSuggestionsFunction.addEnvironment(key, value);
for (const [key, value] of Object.entries(assistant.activityEnv)) backend.assistantActivityFunction.addEnvironment(key, value);
for (const [key, value] of Object.entries(assistant.taskRestEnv)) backend.taskRestFunction.addEnvironment(key, value);
backend.addOutput({ custom: { teamtaskApi: { url: assistant.api.url } } });

// --- AI planning with human approval (Step Functions) ---------------------------------------
// The data-stack functions that call the model (plan-workflow, weekly-report) use the same model
// as the assistant. The guardrail's "id:version" is read at run time from the SSM parameter the
// assistant stack writes (a direct reference would make the data and assistant stacks depend on
// each other). The optional Teams/Slack webhook URL is a SecureString parameter created by hand:
//   aws ssm put-parameter --type SecureString --name /teamtask/<branch>/notifications/chat-webhook --value https://...
const deployment = process.env.AWS_BRANCH ?? 'sandbox';
const modelId = process.env.ASSISTANT_MODEL_ID ?? DEFAULT_ASSISTANT_MODEL;
const baseModel = modelId.replace(/^(eu|us|apac|global)\./, '');
const parameters = {
  GUARDRAIL_PARAMETER: assistant.guardrailParameterName,
  CHAT_WEBHOOK_PARAMETER: `/teamtask/${deployment}/notifications/chat-webhook`,
};
for (const fn of [backend.planWorkflowFunction, backend.weeklyReportFunction, backend.deadlineCheckFunction]) {
  const fnStack = Stack.of(fn.resources.lambda);
  fn.addEnvironment('MODEL_ID', modelId);
  for (const [key, value] of Object.entries(parameters)) fn.addEnvironment(key, value);
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:GetInferenceProfile'],
    resources: [`arn:aws:bedrock:${fnStack.region}:${fnStack.account}:inference-profile/${modelId}`, `arn:aws:bedrock:*::foundation-model/${baseModel}`],
  }));
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: [`arn:aws:bedrock:${fnStack.region}:${fnStack.account}:guardrail/*`] }));
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['ssm:GetParameter'],
    resources: Object.values(parameters).map((name) => `arn:aws:ssm:${fnStack.region}:${fnStack.account}:parameter${name}`),
  }));
}
{
  const fnStack = Stack.of(backend.planWorkflowFunction.resources.lambda);
  backend.planWorkflowFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: [`arn:aws:ses:${fnStack.region}:${fnStack.account}:identity/*`],
  }));
}
const workflows = defineWorkflows({
  workflowFunction: backend.planWorkflowFunction.resources.lambda,
  planningFunction: backend.aiPlanningFunction.resources.lambda,
  deployment,
  decisionDays: Number(process.env.PLAN_DECISION_DAYS ?? 7),
});
for (const [key, value] of Object.entries(workflows.env)) backend.aiPlanningFunction.addEnvironment(key, value);

// --- Scheduled checks: EventBridge Scheduler with retries and a dead-letter queue -------------
const schedules = defineSchedules({
  deployment,
  jobs: [
    { id: 'DeadlineCheck', fn: backend.deadlineCheckFunction.resources.lambda, cron: '0 7 * * ? *', description: 'Daily 07:00 UTC: reminders and escalations.' },
    { id: 'WeeklyReport', fn: backend.weeklyReportFunction.resources.lambda, cron: '0 15 ? * FRI *', description: 'Fridays 15:00 UTC: weekly project reports.' },
  ],
});

// --- Operations: KMS, CloudTrail, immutable audit archive, CloudWatch alarms and dashboard --------
// Alarm emails go to ALARM_EMAIL (Amplify console > Hosting > Environment variables); none = no email.
const operations = defineOperations({
  deployment,
  archiveFunction: backend.auditArchiveFunction.resources.lambda,
  auditTable: backend.data.resources.tables.TaskEvent,
  storageBucket: backend.storage.resources.bucket,
  functions: Object.fromEntries(Object.entries({
    'create-task': backend.createTaskFunction, 'update-task': backend.updateTaskFunction, 'change-task-status': backend.changeTaskStatusFunction,
    'assign-task': backend.assignTaskFunction, 'cancel-task': backend.cancelTaskFunction, 'log-event': backend.logEventFunction,
    'deadline-check': backend.deadlineCheckFunction, 'weekly-report': backend.weeklyReportFunction, 'resolve-escalation': backend.resolveEscalationFunction,
    'manage-team-member': backend.manageTeamMemberFunction, 'manage-profile': backend.manageProfileFunction, presence: backend.presenceFunction,
    'assistant-chat': backend.assistantChatFunction, 'assistant-tools': backend.assistantToolsFunction, 'assistant-activity': backend.assistantActivityFunction,
    'career-suggestions': backend.careerSuggestionsFunction, 'ai-planning': backend.aiPlanningFunction, 'plan-workflow': backend.planWorkflowFunction,
    'task-rest': backend.taskRestFunction, 'manage-project': backend.manageProjectFunction,
  }).map(([name, fn]) => [name, fn.resources.lambda])),
  apiName: `teamtask-api-${deployment}`,
  graphqlApiId: backend.data.resources.cfnResources.cfnGraphqlApi.attrApiId,
  stateMachineArn: workflows.stateMachine.stateMachineArn,
  stateMachineName: workflows.stateMachine.stateMachineName,
  deadLetterQueues: { ScheduledChecks: schedules.deadLetters },
  modelId,
  alarmEmail: process.env.ALARM_EMAIL,
});
for (const [key, value] of Object.entries(operations.archiveEnv)) backend.auditArchiveFunction.addEnvironment(key, value);
