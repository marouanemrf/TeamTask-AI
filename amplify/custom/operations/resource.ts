import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, MathExpression, Metric, TextWidget, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import type { IMetric } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { ReadWriteType, Trail } from 'aws-cdk-lib/aws-cloudtrail';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectLockRetention } from 'aws-cdk-lib/aws-s3';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';

export interface OperationsProps {
  deployment: string;
  /** audit-archive (its stack hosts every resource below). */
  archiveFunction: IFunction;
  /** TaskEvent table: its stream feeds the immutable archive. */
  auditTable: ITable;
  /** Bucket of the profile photos and task attachments (CloudTrail data events on attachments). */
  storageBucket: IBucket;
  /** Functions to watch, by display name. */
  functions: Record<string, IFunction>;
  apiName: string;
  graphqlApiId: string;
  stateMachineArn: string;
  stateMachineName: string;
  deadLetterQueues: Record<string, IQueue>;
  modelId: string;
  /** Email that receives the alarms (Amplify console env var ALARM_EMAIL); none = no subscription. */
  alarmEmail?: string;
}

/**
 * Operations: AWS KMS key, CloudTrail trail, immutable audit archive, CloudWatch alarms and dashboard.
 * - KMS: one customer-managed key (yearly rotation) encrypts the trail logs, the archive and the
 *   alarm topic.
 * - CloudTrail: management events of the account (all regions) plus write data events on task
 *   attachments, with log file integrity validation, in a private, encrypted, versioned bucket.
 * - Audit archive: every TaskEvent change is copied to a bucket with S3 Object Lock (governance,
 *   1 year; 1 day for a sandbox), so the business audit log is append-only outside the app too.
 * - Alarms (SNS, optional email): Lambda errors, API Gateway and AppSync 5XX, failed approval
 *   workflows, undelivered scheduled runs and archive failures. Dashboard: the same signals.
 * Own stack: it only reads the other stacks' names and ARNs, nothing refers back to it.
 */
export function defineOperations(props: OperationsProps) {
  const stack = Stack.of(props.archiveFunction);
  const sandbox = props.deployment === 'sandbox';
  const removal = sandbox ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

  // --- KMS ---
  const key = new Key(stack, 'OperationsKey', {
    description: `TeamTask ${props.deployment}: CloudTrail logs, audit archive, alarm topic`,
    enableKeyRotation: true,
    removalPolicy: removal,
  });
  key.addToResourcePolicy(new PolicyStatement({
    actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
    principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
    resources: ['*'],
    conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
  }));
  // CloudTrail encrypts the log files with this key: it must be allowed to (only for this account's trails).
  const trailArn = `arn:aws:cloudtrail:${stack.region}:${stack.account}:trail/teamtask-${props.deployment}`;
  key.addToResourcePolicy(new PolicyStatement({
    sid: 'CloudTrailEncryptLogs',
    actions: ['kms:GenerateDataKey*'],
    principals: [new ServicePrincipal('cloudtrail.amazonaws.com')],
    resources: ['*'],
    conditions: {
      StringEquals: { 'aws:SourceArn': trailArn },
      StringLike: { 'kms:EncryptionContext:aws:cloudtrail:arn': `arn:aws:cloudtrail:*:${stack.account}:trail/*` },
    },
  }));
  key.addToResourcePolicy(new PolicyStatement({
    sid: 'CloudTrailDescribeKey',
    actions: ['kms:DescribeKey'],
    principals: [new ServicePrincipal('cloudtrail.amazonaws.com')],
    resources: ['*'],
    conditions: { StringEquals: { 'aws:SourceArn': trailArn } },
  }));

  // --- CloudTrail ---
  // The log files are encrypted by CloudTrail with the key above; the bucket itself uses S3-managed
  // encryption, so CloudTrail doesn't also need rights on a bucket default key.
  const trailBucket = new Bucket(stack, 'TrailBucket', {
    encryption: BucketEncryption.S3_MANAGED,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    versioned: true,
    lifecycleRules: [{ expiration: Duration.days(400), noncurrentVersionExpiration: Duration.days(30) }],
    removalPolicy: removal,
    autoDeleteObjects: sandbox,
  });
  const trail = new Trail(stack, 'Trail', {
    trailName: `teamtask-${props.deployment}`,
    bucket: trailBucket,
    encryptionKey: key,
    enableFileValidation: true,
    isMultiRegionTrail: true,
    includeGlobalServiceEvents: true,
  });
  trail.addS3EventSelector([{ bucket: props.storageBucket, objectPrefix: 'task-attachments/' }], { readWriteType: ReadWriteType.WRITE_ONLY, includeManagementEvents: false });

  // --- Immutable audit archive ---
  const archive = new Bucket(stack, 'AuditArchive', {
    encryption: BucketEncryption.KMS,
    encryptionKey: key,
    bucketKeyEnabled: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    versioned: true,
    objectLockEnabled: true,
    objectLockDefaultRetention: ObjectLockRetention.governance(Duration.days(sandbox ? 1 : 365)),
    // Locked objects can't be deleted before their retention ends: the bucket is always kept.
    removalPolicy: RemovalPolicy.RETAIN,
  });
  archive.grantPut(props.archiveFunction);
  key.grantEncrypt(props.archiveFunction);
  const archiveFailures = new Queue(stack, 'AuditArchiveFailures', { retentionPeriod: Duration.days(14), encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true });
  props.archiveFunction.addEventSource(new DynamoEventSource(props.auditTable, {
    startingPosition: StartingPosition.TRIM_HORIZON,
    batchSize: 50,
    retryAttempts: 5,
    bisectBatchOnError: true,
    onFailure: new SqsDlq(archiveFailures),
  }));

  // --- Alarms ---
  const topic = new Topic(stack, 'AlarmTopic', { displayName: `TeamTask ${props.deployment} alarms`, masterKey: key });
  if (props.alarmEmail) topic.addSubscription(new EmailSubscription(props.alarmEmail));
  const notify = new SnsAction(topic);
  const alarm = (id: string, metric: IMetric, threshold: number, description: string) => {
    const a = new Alarm(stack, id, {
      metric,
      threshold,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription: description,
    });
    a.addAlarmAction(notify);
    return a;
  };
  const fiveMinutes = Duration.minutes(5);
  for (const [name, fn] of Object.entries(props.functions)) {
    alarm(`${name.replace(/[^A-Za-z0-9]/g, '')}Errors`, fn.metricErrors({ period: fiveMinutes, statistic: 'Sum' }), 1, `${name}: the function failed.`);
  }
  const apiMetric = (metricName: string, statistic = 'Sum') => new Metric({ namespace: 'AWS/ApiGateway', metricName, dimensionsMap: { ApiName: props.apiName }, period: fiveMinutes, statistic });
  const appSyncMetric = (metricName: string, statistic = 'Sum') => new Metric({ namespace: 'AWS/AppSync', metricName, dimensionsMap: { GraphQLAPIId: props.graphqlApiId }, period: fiveMinutes, statistic });
  const sfnMetric = (metricName: string) => new Metric({ namespace: 'AWS/States', metricName, dimensionsMap: { StateMachineArn: props.stateMachineArn }, period: fiveMinutes, statistic: 'Sum' });
  const queueDepth = (q: IQueue) => q.metricApproximateNumberOfMessagesVisible({ period: fiveMinutes, statistic: 'Maximum' });
  alarm('ApiServerErrors', apiMetric('5XXError'), 5, 'REST API (assistant, planning, tasks): 5 or more server errors in 5 minutes.');
  alarm('AppSyncServerErrors', appSyncMetric('5XXError'), 5, 'Data API (AppSync): 5 or more server errors in 5 minutes.');
  alarm('PlanWorkflowFailed', sfnMetric('ExecutionsFailed'), 1, 'An AI plan approval workflow failed.');
  for (const [name, q] of Object.entries({ ...props.deadLetterQueues, AuditArchive: archiveFailures })) {
    alarm(`${name}DeadLetters`, queueDepth(q), 1, `${name}: messages could not be delivered or processed (dead-letter queue).`);
  }

  // --- Dashboard ---
  const fnMetrics = (pick: (fn: IFunction) => IMetric) => Object.values(props.functions).map(pick);
  const dashboard = new Dashboard(stack, 'Dashboard', { dashboardName: `TeamTask-${props.deployment}` });
  dashboard.addWidgets(new TextWidget({ markdown: `# TeamTask AI · ${props.deployment}\nLambda, APIs, AI workflows and scheduled checks. Alarms notify the SNS topic **${props.deployment}**.`, width: 24, height: 2 }));
  dashboard.addWidgets(
    new GraphWidget({ title: 'Lambda errors', left: fnMetrics((fn) => fn.metricErrors({ period: fiveMinutes })), width: 12 }),
    new GraphWidget({ title: 'Lambda duration (p95)', left: fnMetrics((fn) => fn.metricDuration({ period: fiveMinutes, statistic: 'p95' })), width: 12 }),
  );
  dashboard.addWidgets(
    new GraphWidget({ title: 'REST API requests and errors', left: [apiMetric('Count'), apiMetric('4XXError'), apiMetric('5XXError')], right: [apiMetric('Latency', 'p95')], width: 12 }),
    new GraphWidget({ title: 'Data API (AppSync)', left: [appSyncMetric('4XXError'), appSyncMetric('5XXError')], right: [appSyncMetric('Latency', 'p95')], width: 12 }),
  );
  dashboard.addWidgets(
    new GraphWidget({ title: 'AI plan approvals (Step Functions)', left: [sfnMetric('ExecutionsStarted'), sfnMetric('ExecutionsSucceeded'), sfnMetric('ExecutionsFailed')], width: 8 }),
    new GraphWidget({
      title: 'Bedrock model',
      left: [new Metric({ namespace: 'AWS/Bedrock', metricName: 'Invocations', dimensionsMap: { ModelId: props.modelId }, period: fiveMinutes, statistic: 'Sum' })],
      right: [new Metric({ namespace: 'AWS/Bedrock', metricName: 'InvocationLatency', dimensionsMap: { ModelId: props.modelId }, period: fiveMinutes, statistic: 'p95' })],
      width: 8,
    }),
    new GraphWidget({ title: 'Dead-letter queues', left: Object.values({ ...props.deadLetterQueues, AuditArchive: archiveFailures }).map(queueDepth), width: 8 }),
  );
  dashboard.addWidgets(new GraphWidget({
    title: 'Lambda invocations (all functions)',
    left: [new MathExpression({ expression: 'SUM(METRICS())', usingMetrics: Object.fromEntries(Object.values(props.functions).map((fn, i) => [`m${i}`, fn.metricInvocations({ period: fiveMinutes })])), label: 'Invocations', period: fiveMinutes })],
    width: 24,
  }));

  // ARCHIVE_BUCKET for the archive function (set in backend.ts: IFunction has no addEnvironment).
  return { key, trail, archive, topic, dashboard, archiveEnv: { ARCHIVE_BUCKET: archive.bucketName } };
}
