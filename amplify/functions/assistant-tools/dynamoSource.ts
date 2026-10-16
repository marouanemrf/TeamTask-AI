import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { ScanCommandInput } from "@aws-sdk/lib-dynamodb";
import type { ActivityRow, DataSource, DependencyRow, EscalationRow, EventRow, MemberRow, ProjectRow, ReportRow, TaskRow } from "./tools";

/**
 * Read-only access to the app's tables (the data API's DynamoDB tables) for the assistant tools.
 * Table names come from the environment (set in amplify/custom/assistant/resource.ts). The IAM
 * role only allows reads on these tables, plus the assistant table for activity.
 * Scans are paginated; the tools still re-check the organisation on every row.
 */
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

async function scan<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as T[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** `attr IN (:v0, :v1, …)` scans, 100 values per request (DynamoDB limit). */
async function scanIn<T>(tableName: string, attr: string, values: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const names = chunk.map((_, j) => `:v${j}`);
    out.push(...(await scan<T>({
      TableName: tableName,
      FilterExpression: `#a IN (${names.join(", ")})`,
      ExpressionAttributeNames: { "#a": attr },
      ExpressionAttributeValues: Object.fromEntries(chunk.map((v, j) => [names[j], v])),
    })));
  }
  return out;
}

const get = async <T>(tableName: string, id: string) => ((await db.send(new GetCommand({ TableName: tableName, Key: { id } }))).Item as T | undefined) ?? null;

export const dynamoSource: DataSource = {
  members: (orgId) => scan<MemberRow>({ TableName: table("TABLE_TEAMMEMBER"), FilterExpression: "organisationId = :o", ExpressionAttributeValues: { ":o": orgId } }),
  projects: (orgId) => scan<ProjectRow>({ TableName: table("TABLE_PROJECT"), FilterExpression: "organisationId = :o", ExpressionAttributeValues: { ":o": orgId } }),
  project: (id) => get<ProjectRow>(table("TABLE_PROJECT"), id),
  tasks: (projectIds) => (projectIds.length ? scanIn<TaskRow>(table("TABLE_TASK"), "projectId", projectIds) : Promise.resolve([])),
  task: (id) => get<TaskRow>(table("TABLE_TASK"), id),
  dependencies: async (taskIds) => {
    if (!taskIds.length) return [];
    const [from, to] = await Promise.all([scanIn<DependencyRow>(table("TABLE_DEPENDENCY"), "fromTaskId", taskIds), scanIn<DependencyRow>(table("TABLE_DEPENDENCY"), "toTaskId", taskIds)]);
    return [...from, ...to];
  },
  reports: (projectId) => scan<ReportRow>({ TableName: table("TABLE_WEEKLYREPORT"), FilterExpression: "projectId = :p", ExpressionAttributeValues: { ":p": projectId } }),
  openEscalations: () => scan<EscalationRow>({ TableName: table("TABLE_ESCALATION"), FilterExpression: "#s = :open", ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":open": "OPEN" } }),
  events: (sinceIso) => scan<EventRow>({ TableName: table("TABLE_TASKEVENT"), FilterExpression: "createdAt >= :s", ExpressionAttributeValues: { ":s": sinceIso } }),
  activity: async (orgId, sinceIso) => {
    const items: ActivityRow[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(new QueryCommand({
        TableName: table("ASSISTANT_TABLE"),
        KeyConditionExpression: "pk = :pk AND sk >= :from",
        ExpressionAttributeValues: { ":pk": `ORG#${orgId}`, ":from": `ACT#${sinceIso}` },
        ExclusiveStartKey,
      }));
      items.push(...((page.Items ?? []) as ActivityRow[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  },
};
