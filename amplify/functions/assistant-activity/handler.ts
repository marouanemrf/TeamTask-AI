import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { identityFromClaims } from "../assistant-chat/chatCore";
import { organisationOf } from "../shared/assistantIdentity";

/**
 * GET /assistant/executions?days=7 — the assistant's recorded executions (status, timing, tool
 * steps with their outcome). These records never contain message text or tool data.
 * Everyone sees their own executions; an ADMIN sees the whole organisation's (with the role, not
 * the person).
 */
interface ApiEvent {
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { authorizer?: { claims?: Record<string, unknown> } };
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function respond(event: ApiEvent, statusCode: number, body: unknown) {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: ApiEvent) => {
  const identity = identityFromClaims(event.requestContext?.authorizer?.claims);
  if (!identity) return respond(event, 401, { error: { code: "UNAUTHORIZED", message: "Sign in again." } });
  if (!identity.emailVerified) return respond(event, 403, { error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email address first." } });
  const orgId = await organisationOf(identity);
  if (!orgId) return respond(event, 200, { scope: "own", executions: [] });

  const days = Math.min(Math.max(Number(event.queryStringParameters?.days ?? 7) || 7, 1), 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const userHash = createHash("sha256").update(identity.userId).digest("hex").slice(0, 16);
  const isAdmin = identity.role === "ADMIN";

  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: process.env.ASSISTANT_TABLE!,
      KeyConditionExpression: "pk = :pk AND sk >= :from",
      FilterExpression: isAdmin ? "kind = :session" : "kind = :session AND userHash = :me",
      ExpressionAttributeValues: { ":pk": `ORG#${orgId}`, ":from": `ACT#${since}`, ":session": "SESSION", ...(isAdmin ? {} : { ":me": userHash }) },
      ExclusiveStartKey,
    }));
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const executions = items
    .filter((i) => typeof i.executionId === "string")
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 100)
    .map((i) => ({
      executionId: i.executionId,
      startedAt: i.startedAt ?? i.at,
      durationMs: i.durationMs ?? null,
      status: i.status ?? (i.outcome === "OK" ? "COMPLETED" : "FAILED"),
      errorCode: i.errorCode ?? null,
      steps: Array.isArray(i.steps) ? i.steps : [],
      guardrailInterventions: i.guardrailInterventions ?? 0,
      route: i.route ?? null,
      projectId: i.projectId ?? null,
      mine: i.userHash === userHash,
      ...(isAdmin ? { role: i.role ?? null } : {}),
    }));
  return respond(event, 200, { scope: isAdmin ? "organisation" : "own", days, executions });
};
