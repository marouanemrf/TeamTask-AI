import { createHash, randomUUID } from "node:crypto";
import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { recordActivity } from "../shared/assistantActivity";
import { organisationOf } from "../shared/assistantIdentity";
import { ASSISTANT_INSTRUCTION, converseToolSpecs } from "../shared/assistantPrompt";
import { AGENT_NAME, conversationFor, ExecutionTracker, identityFromClaims, parseChatRequest, RATE_LIMIT_PER_HOUR, rateKey, sessionAttributesFor, systemContext } from "./chatCore";
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

const bedrock = new BedrockRuntimeClient({});
const lambda = new LambdaClient({});
/** Model ↔ tools round trips per answer (each tool call is one). */
const MAX_TURNS = 6;
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

/**
 * Runs one tool in the assistant-tools function (read-only, organisation-scoped). The identity it
 * trusts (sessionAttributes) comes from the token here, never from the model: the model only
 * chooses the tool and its parameters.
 */
async function runTool(name: string, input: unknown, sessionAttributes: Record<string, string>): Promise<string> {
  const parameters = Object.entries(input && typeof input === "object" ? (input as Record<string, unknown>) : {}).map(([key, value]) => ({
    name: key,
    type: "string",
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  const response = await lambda.send(new InvokeCommand({
    FunctionName: process.env.TOOLS_FUNCTION_NAME!,
    Payload: Buffer.from(JSON.stringify({ messageVersion: "1.0", actionGroup: "teamtask-tools", function: name, parameters, sessionAttributes })),
  }));
  if (response.FunctionError || !response.Payload) throw new Error(`tool ${name} failed`);
  const result = JSON.parse(Buffer.from(response.Payload).toString("utf8")) as { response?: { functionResponse?: { responseBody?: { TEXT?: { body?: string } } } } };
  return result.response?.functionResponse?.responseBody?.TEXT?.body ?? JSON.stringify({ status: "ERROR" });
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
    const { message, pageContext, history } = request.value;
    const sessionAttributes = sessionAttributesFor(identity, orgId ?? "");
    const messages: Message[] = conversationFor(history, message);
    const toolSpecs = converseToolSpecs();
    let answered = "";

    // Model ↔ tools loop (Bedrock Converse tool use). Text streams to the browser as it comes.
    for (let turn = 0; ; turn++) {
      if (turn === MAX_TURNS) throw Object.assign(new Error("too many tool calls"), { name: "TooManyTurns" });
      const response = await bedrock.send(new ConverseStreamCommand({
        modelId: process.env.MODEL_ID!,
        system: [{ text: ASSISTANT_INSTRUCTION }, { text: systemContext(identity, pageContext) }],
        messages,
        toolConfig: { tools: toolSpecs as never },
        inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
        guardrailConfig: { guardrailIdentifier: process.env.GUARDRAIL_ID!, guardrailVersion: process.env.GUARDRAIL_VERSION!, trace: "enabled", streamProcessingMode: "sync" },
      }));

      const blocks = new Map<number, { text: string } | { toolUseId: string; name: string; input: string }>();
      let stopReason: string | undefined;
      let turnStarted = false;
      for await (const event of response.stream ?? []) {
        const start = event.contentBlockStart;
        if (start?.start?.toolUse) blocks.set(start.contentBlockIndex ?? 0, { toolUseId: start.start.toolUse.toolUseId ?? "", name: start.start.toolUse.name ?? "", input: "" });
        const delta = event.contentBlockDelta;
        if (delta?.delta?.text) {
          const i = delta.contentBlockIndex ?? 0;
          const block = blocks.get(i) ?? { text: "" };
          if ("text" in block) block.text += delta.delta.text;
          blocks.set(i, block);
          // A new round of text after tool calls starts a new paragraph.
          const text = !turnStarted && answered && !answered.endsWith("\n") ? `\n\n${delta.delta.text}` : delta.delta.text;
          turnStarted = true;
          answered += text;
          send({ type: "chunk", text });
        }
        if (delta?.delta?.toolUse?.input) {
          const block = blocks.get(delta.contentBlockIndex ?? 0);
          if (block && "toolUseId" in block) block.input += delta.delta.toolUse.input;
        }
        if (event.messageStop) stopReason = event.messageStop.stopReason;
      }

      if (stopReason === "guardrail_intervened") {
        tracker.guardrailIntervened().forEach(send);
        break;
      }
      const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b);
      const toolUses = ordered.filter((b): b is { toolUseId: string; name: string; input: string } => "toolUseId" in b);
      if (stopReason !== "tool_use" || !toolUses.length) break;

      const content: ContentBlock[] = [];
      for (const b of ordered) {
        if ("text" in b) {
          if (b.text.trim()) content.push({ text: b.text });
        } else {
          let input: unknown = {};
          try {
            input = b.input ? JSON.parse(b.input) : {};
          } catch {
            input = {};
          }
          content.push({ toolUse: { toolUseId: b.toolUseId, name: b.name, input: input as never } });
        }
      }
      messages.push({ role: "assistant", content });

      const results: ContentBlock[] = [];
      for (const use of content.filter((c) => c.toolUse)) {
        const { toolUseId, name, input } = use.toolUse!;
        tracker.toolStarted(name!).forEach(send);
        let body: string;
        try {
          body = await runTool(name!, input, sessionAttributes);
        } catch (error) {
          console.error(JSON.stringify({ fn: "assistant-chat", tool: name, error: error instanceof Error ? error.message : String(error) }));
          body = JSON.stringify({ status: "ERROR", message: "The data could not be read. Try again later." });
        }
        tracker.toolFinished(body).forEach(send);
        results.push({ toolResult: { toolUseId: toolUseId!, content: [{ text: body }] } });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    outcome = "ERROR";
    const name = error instanceof Error ? error.name : "Error";
    errorCode = name === "ThrottlingException" ? "BUSY" : name === "TooManyTurns" ? "TOO_MANY_STEPS" : "AGENT_ERROR";
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
