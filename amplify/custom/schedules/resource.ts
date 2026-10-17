import { Duration, Stack } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';

export interface ScheduleProps {
  deployment: string;
  jobs: { id: string; fn: IFunction; cron: string; description: string }[];
}

/**
 * Timed checks with Amazon EventBridge Scheduler (instead of plain EventBridge rules): each run is
 * retried up to 3 times within an hour, and a run that still can't be delivered lands in a dead-
 * letter queue (alarmed in the operations stack) instead of being lost. Times are UTC.
 * Built in the stack of the scheduled functions.
 */
export function defineSchedules(props: ScheduleProps) {
  const stack = Stack.of(props.jobs[0].fn);
  const deadLetters = new Queue(stack, 'ScheduleDeadLetters', {
    retentionPeriod: Duration.days(14),
    encryption: QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
  });
  const role = new Role(stack, 'SchedulerInvokeRole', {
    assumedBy: new ServicePrincipal('scheduler.amazonaws.com', { conditions: { StringEquals: { 'aws:SourceAccount': stack.account } } }),
    description: 'EventBridge Scheduler: invoke the TeamTask scheduled functions.',
  });
  deadLetters.grantSendMessages(role);
  for (const job of props.jobs) {
    job.fn.grantInvoke(role);
    new CfnSchedule(stack, `${job.id}Schedule`, {
      name: `teamtask-${job.id.toLowerCase()}-${props.deployment}`.slice(0, 64),
      description: job.description,
      scheduleExpression: `cron(${job.cron})`,
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: job.fn.functionArn,
        roleArn: role.roleArn,
        input: JSON.stringify({ source: 'scheduler', job: job.id }),
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
        deadLetterConfig: { arn: deadLetters.queueArn },
      },
    });
  }
  return { deadLetters };
}
