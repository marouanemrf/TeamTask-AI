import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { organisationFromGroups } from "./tenancy";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const orgCache = new Map<string, string | null>();

async function scanAll(TableName: string, FilterExpression?: string, values?: Record<string, unknown>) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ TableName, FilterExpression, ExpressionAttributeValues: values, ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * The caller's organisation: the organisation group of the token (set by the server only, see
 * shared/tenancy.ts), else their team record (lookup by the token's email). Never guessed.
 * Needs TABLE_TEAMMEMBER.
 */
export async function organisationOf(identity: { email: string; groups?: readonly string[] }): Promise<string | null> {
  const fromToken = organisationFromGroups(identity.groups);
  if (fromToken) return fromToken;
  if (orgCache.has(identity.email)) return orgCache.get(identity.email)!;
  const mine = await scanAll(process.env.TABLE_TEAMMEMBER!, "email = :e", { ":e": identity.email });
  const orgId = (mine[0]?.organisationId as string | undefined) ?? null;
  orgCache.set(identity.email, orgId);
  return orgId;
}
