import { createHash } from 'node:crypto';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  AccessLogFormat,
  CognitoUserPoolsAuthorizer,
  JsonSchemaType,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  Model,
  RequestValidator,
  ResponseTransferMode,
  ResponseType,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { CfnGuardrail, CfnGuardrailVersion } from 'aws-cdk-lib/aws-bedrock';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';

/** Default model: Claude Haiku 4.5 through the EU cross-region inference profile. */
export const DEFAULT_ASSISTANT_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

export interface AssistantProps {
  toolsFunction: IFunction;
  chatFunction: IFunction;
  /** POST /profile/career-suggestions (Bedrock Converse on the caller's profile, or a member's for managers). */
  careerFunction: IFunction;
  /** GET /assistant/executions (recorded executions: own, or the organisation's for ADMIN). */
  activityFunction: IFunction;
  /** REST task API (/tasks, /projects/{id}/tasks), forwarded to the data API with the caller's token. */
  taskRestFunction: IFunction;
  /** GraphQL endpoint of the data API. */
  graphqlUrl: string;
  userPool: IUserPool;
  /** The data API's tables, by model name. */
  tables: Record<string, ITable>;
  deployment: string;
  allowedOrigins: string[];
  modelId: string;
}

/**
 * TeamTask assistant for all users, behind POST /assistant/chat on API Gateway (Cognito authorizer,
 * streaming, throttling, access logs). assistant-chat runs the model with the Bedrock Converse API
 * (tool use, guardrail) and calls the read-only tools in assistant-tools. No Bedrock Agent: Agents
 * (classic) is in maintenance mode and refuses new agents in accounts that never used it.
 * Built in the stack of the functions (resourceGroupName "assistant") so no nested stacks depend on
 * each other.
 */
export function defineAssistant(props: AssistantProps) {
  const stack = Stack.of(props.toolsFunction);
  const sandbox = props.deployment === 'sandbox';

  // --- Activity + rate-limit table ---
  const table = new Table(stack, 'AssistantTable', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey: { name: 'sk', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expiresAt',
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    // AWS-owned KMS encryption (what is deployed). Switching to a customer-managed key changes the
    // table's encryption, which DynamoDB limits per day; the operations key covers the audit data.
    encryption: TableEncryption.AWS_MANAGED,
    removalPolicy: sandbox ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });

  // --- Guardrail ---
  const guardrail = new CfnGuardrail(stack, 'AssistantGuardrail', {
    name: `teamtask-assistant-${props.deployment}`,
    description: 'TeamTask assistant: prompt attacks, off-topic requests, PII in answers.',
    blockedInputMessaging: "I can't help with that request. I can answer questions about your projects and tasks.",
    blockedOutputsMessaging: "I can't share that answer. Ask me about your projects and tasks.",
    contentPolicyConfig: {
      filtersConfig: [
        { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        { type: 'HATE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
      ],
    },
    topicPolicyConfig: {
      topicsConfig: [{
        name: 'Unrelated-topics',
        type: 'DENY',
        definition: 'Requests unrelated to project management, tasks, deadlines, team workload, reports or the TeamTask application, such as general knowledge, coding help, personal advice or entertainment.',
        examples: ['Write me a poem about the sea', 'What is the capital of Australia?', 'Give me investment advice'],
      }],
    },
    sensitiveInformationPolicyConfig: {
      piiEntitiesConfig: [
        { type: 'EMAIL', action: 'ANONYMIZE', inputAction: 'NONE', outputAction: 'ANONYMIZE', inputEnabled: false, outputEnabled: true },
        { type: 'PHONE', action: 'ANONYMIZE', inputAction: 'NONE', outputAction: 'ANONYMIZE', inputEnabled: false, outputEnabled: true },
      ],
    },
  });
  const guardrailVersion = new CfnGuardrailVersion(stack, 'AssistantGuardrailVersion', {
    guardrailIdentifier: guardrail.attrGuardrailId,
    description: createHash('sha256').update(JSON.stringify(guardrail._toCloudFormation())).digest('hex').slice(0, 16),
  });

  const baseModel = props.modelId.replace(/^(eu|us|apac|global)\./, '');
  const modelResources = [`arn:aws:bedrock:${stack.region}:${stack.account}:inference-profile/${props.modelId}`, `arn:aws:bedrock:*::foundation-model/${baseModel}`];

  // Read at run time by the data-stack functions that call the model (planning, weekly report).
  const guardrailParameterName = `/teamtask/${props.deployment}/assistant/guardrail`;
  new StringParameter(stack, 'AssistantGuardrailParameter', {
    parameterName: guardrailParameterName,
    stringValue: `${guardrail.attrGuardrailId}:${guardrailVersion.attrVersion}`,
    description: 'Guardrail of the TeamTask AI features (id:version).',
  });

  new StringParameter(stack, 'AssistantModelIdParameter', {
    parameterName: `/teamtask/${props.deployment}/assistant/modelId`,
    stringValue: props.modelId,
    description: 'Foundation model of the TeamTask assistant (set ASSISTANT_MODEL_ID at deploy time to change it).',
  });

  // --- Function permissions (least privilege) ---
  const toolsEnv: Record<string, string> = { ASSISTANT_TABLE: table.tableName };
  for (const name of ['TeamMember', 'Project', 'Task', 'Dependency', 'WeeklyReport', 'Escalation', 'TaskEvent']) {
    const t = props.tables[name];
    props.toolsFunction.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:Query'], resources: [t.tableArn] }));
    toolsEnv[`TABLE_${name.toUpperCase()}`] = t.tableName;
  }
  // Assistant table: tools only write activity and read it back, under ORG# keys.
  props.toolsFunction.addToRolePolicy(new PolicyStatement({
    actions: ['dynamodb:PutItem', 'dynamodb:Query'],
    resources: [table.tableArn],
    conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['ORG#*'] } },
  }));

  for (const name of ['TeamMember', 'Organisation']) {
    props.chatFunction.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:Scan'], resources: [props.tables[name].tableArn] }));
  }
  props.chatFunction.addToRolePolicy(new PolicyStatement({
    actions: ['dynamodb:UpdateItem', 'dynamodb:PutItem'],
    resources: [table.tableArn],
    conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['RATE#*', 'ORG#*'] } },
  }));
  // Chat: only the configured model (streaming Converse), the guardrail, and the tools function.
  props.chatFunction.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:GetInferenceProfile'],
    resources: modelResources,
  }));
  props.chatFunction.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: [guardrail.attrGuardrailArn] }));
  props.toolsFunction.grantInvoke(props.chatFunction);

  // --- REST API ---
  const accessLogs = new LogGroup(stack, 'TeamTaskApiAccessLogs', {
    retention: RetentionDays.THREE_MONTHS,
    removalPolicy: sandbox ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });
  const api = new RestApi(stack, 'TeamTaskApi', {
    restApiName: `teamtask-api-${props.deployment}`,
    description: 'TeamTask REST API (assistant).',
    deployOptions: {
      stageName: 'prod',
      throttlingBurstLimit: 50,
      throttlingRateLimit: 20,
      metricsEnabled: true,
      loggingLevel: MethodLoggingLevel.ERROR,
      dataTraceEnabled: false, // never log request bodies (messages may contain personal data)
      accessLogDestination: new LogGroupLogDestination(accessLogs),
      accessLogFormat: AccessLogFormat.custom(JSON.stringify({
        requestId: '$context.requestId', ip: '$context.identity.sourceIp', method: '$context.httpMethod', path: '$context.resourcePath',
        status: '$context.status', latencyMs: '$context.responseLatency', user: '$context.authorizer.claims.sub', error: '$context.error.message',
      })),
    },
    defaultCorsPreflightOptions: { allowOrigins: props.allowedOrigins, allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'], maxAge: Duration.hours(1) },
  });
  // Errors produced by API Gateway itself (401, 429, 400) must carry CORS headers too.
  for (const type of [ResponseType.DEFAULT_4XX, ResponseType.DEFAULT_5XX]) {
    api.addGatewayResponse(`Cors${type.responseType}`, { type, responseHeaders: { 'Access-Control-Allow-Origin': `'${props.allowedOrigins[0]}'` } });
  }
  const authorizer = new CognitoUserPoolsAuthorizer(stack, 'TeamTaskApiAuthorizer', { cognitoUserPools: [props.userPool] });
  const chatModel = new Model(stack, 'AssistantChatModel', {
    restApi: api,
    contentType: 'application/json',
    schema: {
      type: JsonSchemaType.OBJECT,
      required: ['message'],
      properties: {
        message: { type: JsonSchemaType.STRING, minLength: 1, maxLength: 2000 },
        conversationId: { type: JsonSchemaType.STRING, maxLength: 128 },
        pageContext: { type: JsonSchemaType.OBJECT },
        history: {
          type: JsonSchemaType.ARRAY,
          maxItems: 20,
          items: { type: JsonSchemaType.OBJECT, properties: { role: { type: JsonSchemaType.STRING, enum: ['user', 'assistant'] }, text: { type: JsonSchemaType.STRING, maxLength: 8000 } } },
        },
      },
    },
  });
  const assistantResource = api.root.addResource('assistant');
  assistantResource.addResource('chat').addMethod(
    'POST',
    new LambdaIntegration(props.chatFunction, { proxy: true, responseTransferMode: ResponseTransferMode.STREAM, timeout: Duration.minutes(2) }),
    {
      authorizer,
      requestValidator: new RequestValidator(stack, 'AssistantChatValidator', { restApi: api, validateRequestBody: true }),
      requestModels: { 'application/json': chatModel },
    },
  );

  assistantResource.addResource('executions').addMethod('GET', new LambdaIntegration(props.activityFunction, { proxy: true }), {
    authorizer,
    requestParameters: { 'method.request.querystring.days': false },
  });
  // REST task API: same rules as the app (forwarded to the task functions with the caller's token).
  const taskIntegration = new LambdaIntegration(props.taskRestFunction, { proxy: true, timeout: Duration.seconds(29) });
  const tasks = api.root.addResource('tasks');
  tasks.addMethod('POST', taskIntegration, { authorizer });
  const task = tasks.addResource('{taskId}');
  task.addMethod('GET', taskIntegration, { authorizer });
  task.addMethod('PATCH', taskIntegration, { authorizer });
  for (const action of ['status', 'assign', 'close']) task.addResource(action).addMethod('POST', taskIntegration, { authorizer });
  api.root.addResource('projects').addResource('{projectId}').addResource('tasks').addMethod('GET', taskIntegration, { authorizer });

  api.root.addResource('profile').addResource('career-suggestions').addMethod('POST', new LambdaIntegration(props.careerFunction, { proxy: true, timeout: Duration.seconds(29) }), { authorizer });

  // Career suggestions: own counter under RATE#, read-only on the profile tables, the model and guardrail.
  props.careerFunction.addToRolePolicy(new PolicyStatement({
    actions: ['dynamodb:UpdateItem'],
    resources: [table.tableArn],
    conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['RATE#career#*'] } },
  }));
  // Scan on Project: the organisation's open projects that the suggestions are matched with.
  for (const name of ['TeamMember', 'Task', 'Project']) props.careerFunction.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:Scan'], resources: [props.tables[name].tableArn] }));
  // GetItem on TeamMember: a manager asking for a member's suggestions (by member id).
  props.careerFunction.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [props.tables.Project.tableArn, props.tables.TeamMember.tableArn] }));
  props.careerFunction.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:GetInferenceProfile'],
    resources: modelResources,
  }));
  props.careerFunction.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: [guardrail.attrGuardrailArn] }));

  // Activity: read the organisation's execution records (ORG# keys) and the caller's organisation.
  props.activityFunction.addToRolePolicy(new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [table.tableArn],
    conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['ORG#*'] } },
  }));
  for (const name of ['TeamMember', 'Organisation']) props.activityFunction.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:Scan'], resources: [props.tables[name].tableArn] }));

  const careerEnv: Record<string, string> = {
    ASSISTANT_TABLE: table.tableName,
    TABLE_TEAMMEMBER: props.tables.TeamMember.tableName,
    TABLE_TASK: props.tables.Task.tableName,
    TABLE_PROJECT: props.tables.Project.tableName,
    MODEL_ID: props.modelId,
    GUARDRAIL_ID: guardrail.attrGuardrailId,
    GUARDRAIL_VERSION: guardrailVersion.attrVersion,
    ALLOWED_ORIGINS: props.allowedOrigins.join(','),
  };
  const activityEnv: Record<string, string> = {
    ASSISTANT_TABLE: table.tableName,
    TABLE_TEAMMEMBER: props.tables.TeamMember.tableName,
    TABLE_ORGANISATION: props.tables.Organisation.tableName,
    ALLOWED_ORIGINS: props.allowedOrigins.join(','),
  };

  const taskRestEnv: Record<string, string> = { GRAPHQL_URL: props.graphqlUrl, ALLOWED_ORIGINS: props.allowedOrigins.join(',') };

  const chatEnv: Record<string, string> = {
    MODEL_ID: props.modelId,
    GUARDRAIL_ID: guardrail.attrGuardrailId,
    GUARDRAIL_VERSION: guardrailVersion.attrVersion,
    TOOLS_FUNCTION_NAME: props.toolsFunction.functionName,
    ASSISTANT_TABLE: table.tableName,
    TABLE_TEAMMEMBER: props.tables.TeamMember.tableName,
    TABLE_ORGANISATION: props.tables.Organisation.tableName,
    ALLOWED_ORIGINS: props.allowedOrigins.join(','),
  };

  new CfnOutput(stack, 'TeamTaskApiUrl', { value: api.url });
  // Environment variables for the functions (applied in backend.ts with addEnvironment).
  return { api, table, guardrail, guardrailParameterName, toolsEnv, chatEnv, careerEnv, activityEnv, taskRestEnv };
}
