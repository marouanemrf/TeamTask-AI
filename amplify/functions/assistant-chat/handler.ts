import { createHash, randomUUID } from "node:crypto";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { recordActivity } from "../shared/assistantActivity";
import { organisationOf } from "../shared/assistantIdentity";
import { AGENT_NAME, ExecutionTracker, identityFromClaims, parseChatRequest, RATE_LIMIT_PER_HOUR, rateKey, sessionAttributesFor, sessionIdFor } from "./chatCore";
import type { ClientEvent } from "./chatCore";

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

export const handler = awslambda.streamifyResponse(async (event: ApiEvent, stream: ResponseStream) => {
  const started = Date.now();
  const executionId = randomUUID();
  const identity = identityFromClaims(event.requestContext?.authorizer?.claims);
  if (!identity) return reply(stream, event, 401, "UNAUTHORIZED", "Sign in again.");
  if (!identity.emailVerified) return reply(stream, event, 403, "EMAIL_NOT_VERIFIED", "Verify your email address before using the assistant.");

  const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const request = parseChatRequest(body);
  if (!request.ok) return reply(stream, event, 400, "VALIDATION", request.message);

  const orgId = await organisationOf(identity);
  const userHash = createHash("sha256").update(identity.userId).digest("hex").slice(0, 16);
  if (await overRateLimit(identity.userId)) {
    if (orgId) await recordActivity({ orgId, kind: "SESSION", role: identity.role, userHash, outcome: "RATE_LIMITED", status: "RATE_LIMITED", executionId, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, route: request.value.pageContext.route });
    return reply(stream, event, 429, "RATE_LIMITED", `You can send up to ${RATE_LIMIT_PER_HOUR} messages per hour. Try again later.`);
  }

  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(event) },
  });
  const send = (e: ClientEvent) => out.write(JSON.stringify(e) + "\n");
  const tracker = new ExecutionTracker();
  let outcome: "OK" | "ERROR" = "OK";
  let errorCode: string | undefined;
  // Observable execution: id and start now, then each tool step live, then the final status.
  send({ type: "execution", executionId, agent: AGENT_NAME, startedAt: new Date(started).toISOString() });

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
      if (part.trace?.trace) tracker.handle(part.trace.trace as never).forEach(send);
    }
  } catch (error) {
    outcome = "ERROR";
    const name = error instanceof Error ? error.name : "Error";
    errorCode = name === "ThrottlingException" ? "BUSY" : "AGENT_ERROR";
    console.error(JSON.stringify({ fn: "assistant-chat", error: name, message: error instanceof Error ? error.message : String(error) }));
    send({ type: "error", code: errorCode, message: name === "ThrottlingException" ? "The assistant is busy. Try again in a moment." : "The assistant couldn't answer. Try again." });
  } finally {
    const durationMs = Date.now() - started;
    send({ type: "done", status: outcome === "OK" ? "COMPLETED" : "FAILED", durationMs });
    out.end();
    if (orgId) {
      await recordActivity({
        orgId, kind: "SESSION", role: identity.role, userHash, outcome, durationMs,
        executionId, status: outcome === "OK" ? "COMPLETED" : "FAILED", startedAt: new Date(started).toISOString(), errorCode,
        toolsCalled: tracker.toolsCalled, guardrailInterventions: tracker.guardrailInterventions,
        steps: tracker.steps.map(({ tool, status, summary, durationMs: d }) => ({ tool, status, summary, durationMs: d })),
        route: request.value.pageContext.route, projectId: request.value.pageContext.projectId,
      });
    }
  }
});
