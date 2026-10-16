import { createHash } from "node:crypto";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { recordActivity } from "../shared/assistantActivity";
import { identityFromClaims, parseChatRequest, RATE_LIMIT_PER_HOUR, rateKey, sessionAttributesFor, sessionIdFor, traceToEvents } from "./chatCore";
import type { ClientEvent, Identity } from "./chatCore";

/* Lambda response streaming (Node.js runtime globals). */
interface ResponseStream {
  write(chunk: string): void;
  end(): void;
}
declare const awslambda: {
  streamifyResponse(handler: (event: ApiEvent, stream: ResponseStream) => Promise<void>): unknown;
  HttpResponseStream: { from(stream: ResponseStream, metadata: { statusCode: number; headers: Record<string, string> }): ResponseStream };
};
interface ApiEvent {
  body: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { authorizer?: { claims?: Record<string, unknown> } };
}

const agent = new BedrockAgentRuntimeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const orgCache = new Map<string, string | null>();

function corsHeaders(event: ApiEvent): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";
  return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function reply(stream: ResponseStream, event: ApiEvent, statusCode: number, code: string, message: string) {
  const out = awslambda.HttpResponseStream.from(stream, { statusCode, headers: { "Content-Type": "application/json", ...corsHeaders(event) } });
  out.write(JSON.stringify({ error: { code, message } }));
  out.end();
}

/** 30 messages per user per hour (counter item per hour bucket, expires after 2 hours). */
async function overRateLimit(userId: string): Promise<boolean> {
  const result = await db.send(new UpdateCommand({
    TableName: process.env.ASSISTANT_TABLE!,
    Key: rateKey(userId),
    UpdateExpression: "ADD #n :one SET expiresAt = if_not_exists(expiresAt, :exp)",
    ExpressionAttributeNames: { "#n": "count" },
    ExpressionAttributeValues: { ":one": 1, ":exp": Math.floor(Date.now() / 1000) + 7200 },
    ReturnValues: "UPDATED_NEW",
  }));
  return Number(result.Attributes?.count ?? 0) > RATE_LIMIT_PER_HOUR;
}

/**
 * The caller's organisation, from their team record (server-side lookup by the token's email).
 * An ADMIN without a team record belongs to the only organisation, if there is exactly one.
 */
async function organisationOf(identity: Identity): Promise<string | null> {
  if (orgCache.has(identity.email)) return orgCache.get(identity.email)!;
  const scanAll = async (TableName: string, FilterExpression?: string, values?: Record<string, unknown>) => {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(new ScanCommand({ TableName, FilterExpression, ExpressionAttributeValues: values, ExclusiveStartKey }));
      items.push(...((page.Items ?? []) as Record<string, unknown>[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  };
  const mine = await scanAll(process.env.TABLE_TEAMMEMBER!, "email = :e", { ":e": identity.email });
  let orgId = (mine[0]?.organisationId as string | undefined) ?? null;
  if (!orgId && identity.role === "ADMIN") {
    const orgs = await scanAll(process.env.TABLE_ORGANISATION!);
    if (orgs.length === 1) orgId = String(orgs[0].id);
  }
  orgCache.set(identity.email, orgId);
  return orgId;
}

export const handler = awslambda.streamifyResponse(async (event: ApiEvent, stream: ResponseStream) => {
  const started = Date.now();
  const identity = identityFromClaims(event.requestContext?.authorizer?.claims);
  if (!identity) return reply(stream, event, 401, "UNAUTHORIZED", "Sign in again.");

  const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const request = parseChatRequest(body);
  if (!request.ok) return reply(stream, event, 400, "VALIDATION", request.message);

  const orgId = await organisationOf(identity);
  const userHash = createHash("sha256").update(identity.userId).digest("hex").slice(0, 16);
  if (await overRateLimit(identity.userId)) {
    if (orgId) await recordActivity({ orgId, kind: "SESSION", role: identity.role, userHash, outcome: "RATE_LIMITED", durationMs: Date.now() - started });
    return reply(stream, event, 429, "RATE_LIMITED", `You can send up to ${RATE_LIMIT_PER_HOUR} messages per hour. Try again later.`);
  }

  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(event) },
  });
  const send = (e: ClientEvent) => out.write(JSON.stringify(e) + "\n");
  const toolsCalled: string[] = [];
  let guardrailInterventions = 0;
  let outcome: "OK" | "ERROR" = "OK";

  try {
    const { message, conversationId, pageContext } = request.value;
    const response = await agent.send(new InvokeAgentCommand({
      agentId: process.env.AGENT_ID!,
      agentAliasId: process.env.AGENT_ALIAS_ID!,
      sessionId: sessionIdFor(identity.userId, conversationId),
      inputText: message,
      enableTrace: true,
      streamingConfigurations: { streamFinalResponse: true },
      sessionState: {
        // What the tools trust: from the token and the server-side lookup only.
        sessionAttributes: sessionAttributesFor(identity, orgId ?? ""),
        // Context for phrasing; the tools re-check everything.
        promptSessionAttributes: {
          today: new Date().toISOString().slice(0, 10),
          userRole: identity.role,
          currentPage: pageContext.route,
          ...(pageContext.projectId ? { currentProjectId: pageContext.projectId } : {}),
          ...(pageContext.taskId ? { currentTaskId: pageContext.taskId } : {}),
        },
      },
    }));
    for await (const part of response.completion ?? []) {
      if (part.chunk?.bytes) send({ type: "chunk", text: new TextDecoder().decode(part.chunk.bytes) });
      if (part.trace?.trace) {
        const mapped = traceToEvents(part.trace.trace as never);
        if (mapped.tool) toolsCalled.push(mapped.tool);
        if (mapped.guardrail) guardrailInterventions += 1;
        mapped.events.forEach(send);
      }
    }
    send({ type: "done" });
  } catch (error) {
    outcome = "ERROR";
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ fn: "assistant-chat", error: name, message: error instanceof Error ? error.message : String(error) }));
    send({ type: "error", code: name === "ThrottlingException" ? "BUSY" : "AGENT_ERROR", message: name === "ThrottlingException" ? "The assistant is busy. Try again in a moment." : "The assistant couldn't answer. Try again." });
  } finally {
    out.end();
    if (orgId) await recordActivity({ orgId, kind: "SESSION", role: identity.role, userHash, outcome, durationMs: Date.now() - started, toolsCalled, guardrailInterventions });
  }
});
