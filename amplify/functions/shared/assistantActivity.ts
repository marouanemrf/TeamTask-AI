import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Assistant activity (AgentActivity items) in the assistant table: one item per tool call and one
 * per conversation turn. Never the message text or tool results — only what is needed to audit
 * the assistant: tool, role, allowed/denied, duration, outcome, guardrail interventions.
 * Kept 90 days (TTL), partitioned by organisation.
 */
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const KEEP_SECONDS = 90 * 86_400;

export interface ActivityInput {
  orgId: string;
  kind: "TOOL" | "SESSION";
  role: string;
  /** Hash of the Cognito user id, not the id itself. */
  userHash: string;
  tool?: string;
  allowed?: boolean;
  outcome?: "OK" | "ERROR" | "RATE_LIMITED" | "BLOCKED";
  durationMs: number;
  toolsCalled?: string[];
  guardrailInterventions?: number;
  /** Execution record (kind SESSION): id, final status, timing and observable steps — no message text. */
  executionId?: string;
  status?: "COMPLETED" | "FAILED" | "RATE_LIMITED" | "STOPPED";
  startedAt?: string;
  steps?: { tool: string; status: string; summary: string; durationMs?: number }[];
  /** Page the question was asked from (route and ids only). */
  route?: string;
  projectId?: string;
  errorCode?: string;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  const at = new Date().toISOString();
  console.info(JSON.stringify({ fn: "assistant", ...input }));
  try {
    await db.send(new PutCommand({
      TableName: process.env.ASSISTANT_TABLE!,
      Item: { pk: `ORG#${input.orgId}`, sk: `ACT#${at}#${randomUUID()}`, at, ...input, expiresAt: Math.floor(Date.now() / 1000) + KEEP_SECONDS },
    }));
  } catch (error) {
    // Activity is best effort: never fail the user's request because of it.
    console.error(JSON.stringify({ fn: "assistant", activityWriteFailed: error instanceof Error ? error.message : String(error) }));
  }
}
