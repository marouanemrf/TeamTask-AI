import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

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
 * The caller's organisation, from their team record (server-side lookup by the token's email —
 * Cognito has no organisation claim). An ADMIN without a team record belongs to the only
 * organisation, if there is exactly one. Needs TABLE_TEAMMEMBER and TABLE_ORGANISATION.
 */
export async function organisationOf(identity: { email: string; role: string }): Promise<string | null> {
  if (orgCache.has(identity.email)) return orgCache.get(identity.email)!;
  const mine = await scanAll(process.env.TABLE_TEAMMEMBER!, "email = :e", { ":e": identity.email });
  let orgId = (mine[0]?.organisationId as string | undefined) ?? null;
  if (!orgId && identity.role === "ADMIN") {
    const orgs = await scanAll(process.env.TABLE_ORGANISATION!);
    if (orgs.length === 1) orgId = String(orgs[0].id);
  }
  orgCache.set(identity.email, orgId);
  return orgId;
}
