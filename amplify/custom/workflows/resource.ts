import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, Fail, IntegrationPattern, JsonPath, LogLevel, StateMachine, StateMachineType, Succeed, TaskInput, Timeout } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface WorkflowProps {
  /** plan-workflow: the steps. */
  workflowFunction: IFunction;
  /** ai-planning: starts executions and sends the decision. */
  planningFunction: IFunction;
  deployment: string;
  /** Days a plan waits for a decision before it expires. */
  decisionDays: number;
}

/**
 * Human approval of AI plans with AWS Step Functions (Standard workflow):
 *
 *   Generate plan ──► Wait for decision (task token, N days) ──► Approved? ──► Create tasks ──► Done
 *        │                    │ timeout                         └─ rejected ──► Rejected
 *        └─ error ─► Mark failed ─► Failed      └──► Mark expired ──► Expired
 *
 * Nothing is created before a manager approves: the "create tasks" step is only reachable through
 * the decision, which only decideRecommendation can send (states:SendTaskSuccess). Steps are
 * retried on transient Lambda/Bedrock errors; an unusable model answer is retried once.
 * Built in the data stack, next to the two functions (no cross-stack references).
 */
export function defineWorkflows(props: WorkflowProps) {
  const stack = Stack.of(props.workflowFunction);
  const sandbox = props.deployment === 'sandbox';
  const step = (id: string, action: string, extra: Record<string, unknown> = {}) =>
    new LambdaInvoke(stack, id, {
      lambdaFunction: props.workflowFunction,
      payload: TaskInput.fromObject({ action, recommendationId: JsonPath.stringAt('$.recommendationId'), ...extra }),
      resultPath: JsonPath.DISCARD,
      retryOnServiceExceptions: true,
    });

  const markFailed = step('MarkFailed', 'fail', { error: JsonPath.objectAt('$.error') }).next(new Fail(stack, 'PlanFailed', { error: 'PlanFailed' }));
  const markExpired = step('MarkExpired', 'expire').next(new Succeed(stack, 'PlanExpired'));

  const generate = step('GeneratePlan', 'generate');
  generate.addRetry({ errors: ['ThrottlingException', 'ServiceUnavailableException', 'ModelNotReadyException'], interval: Duration.seconds(10), maxAttempts: 3, backoffRate: 2 });
  generate.addRetry({ errors: ['UnusablePlan'], interval: Duration.seconds(2), maxAttempts: 1 });
  generate.addCatch(markFailed, { resultPath: '$.error' });

  const wait = new LambdaInvoke(stack, 'WaitForDecision', {
    lambdaFunction: props.workflowFunction,
    integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    payload: TaskInput.fromObject({ action: 'wait', recommendationId: JsonPath.stringAt('$.recommendationId'), taskToken: JsonPath.taskToken }),
    resultPath: '$.decision',
    taskTimeout: Timeout.duration(Duration.days(props.decisionDays)),
  });
  wait.addCatch(markExpired, { errors: ['States.Timeout'], resultPath: '$.error' });
  wait.addCatch(markFailed, { resultPath: '$.error' });

  const apply = step('CreateTasks', 'apply');
  apply.addRetry({ errors: ['ThrottlingException', 'States.TaskFailed'], interval: Duration.seconds(5), maxAttempts: 2, backoffRate: 2 });
  apply.addCatch(markFailed, { resultPath: '$.error' });

  const definition = generate
    .next(wait)
    .next(new Choice(stack, 'Approved?')
      .when(Condition.stringEquals('$.decision.decision', 'APPROVED'), apply.next(new Succeed(stack, 'TasksCreated')))
      .otherwise(new Succeed(stack, 'PlanRejected')));

  const logs = new LogGroup(stack, 'PlanApprovalLogs', { retention: RetentionDays.THREE_MONTHS, removalPolicy: sandbox ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN });
  const stateMachine = new StateMachine(stack, 'PlanApproval', {
    stateMachineName: `teamtask-plan-approval-${props.deployment}`,
    stateMachineType: StateMachineType.STANDARD,
    definitionBody: DefinitionBody.fromChainable(definition),
    timeout: Duration.days(props.decisionDays + 1),
    tracingEnabled: true,
    logs: { destination: logs, level: LogLevel.ERROR, includeExecutionData: false },
  });

  stateMachine.grantStartExecution(props.planningFunction);
  // Task tokens are not tied to a resource ARN in IAM: this function is the only one allowed to answer.
  props.planningFunction.addToRolePolicy(new PolicyStatement({ actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'], resources: ['*'] }));

  return { stateMachine, env: { PLAN_STATE_MACHINE_ARN: stateMachine.stateMachineArn } };
}
