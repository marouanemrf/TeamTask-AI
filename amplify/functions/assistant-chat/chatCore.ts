import { createHash } from "node:crypto";
import { primaryAssistantRole, STEP_LABELS } from "../shared/assistantAccess";
import type { AssistantRole } from "../shared/assistantAccess";

/** Pure parts of POST /assistant/chat (identity, validation, session, stream mapping), unit-tested. */

export const MAX_MESSAGE = 2000;
export const RATE_LIMIT_PER_HOUR = 30;
const ID = /^[A-Za-z0-9:_-]{1,128}$/;

export interface Identity {
  userId: string;
  email: string;
  /** email_verified claim of the ID token. */
  emailVerified: boolean;
  role: AssistantRole;
  groups: string[];
}

/**
 * Identity from the Cognito authorizer claims (API Gateway validated the ID token). Nothing from
 * the request body is used. "cognito:groups" arrives as "ADMIN", "ADMIN,MEMBER" or "[ADMIN MEMBER]".
 */
export function identityFromClaims(claims: Record<string, unknown> | undefined): Identity | null {
  const userId = typeof claims?.sub === "string" ? claims.sub : "";
  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : "";
  if (!userId || !email) return null;
  const raw = claims?.["cognito:groups"];
  const groups = (Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.replace(/[[\]]/g, "").split(/[\s,]+/) : []).filter(Boolean);
  return { userId, email, emailVerified: String(claims?.email_verified) === "true", role: primaryAssistantRole(groups), groups };
}

export interface ChatRequest {
  message: string;
  conversationId: string;
  pageContext: { route: string; projectId?: string; taskId?: string };
}

/** Validates the body. Unknown fields (e.g. a forged "sessionAttributes" or "role") are dropped. */
export function parseChatRequest(body: string | null | undefined): { ok: true; value: ChatRequest } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(body ?? "");
  } catch {
    return { ok: false, message: "The request body must be JSON." };
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim() : "";
  if (!message) return { ok: false, message: "The message is empty." };
  if (message.length > MAX_MESSAGE) return { ok: false, message: `The message must be at most ${MAX_MESSAGE} characters.` };
  const conversationId = typeof r.conversationId === "string" && ID.test(r.conversationId) ? r.conversationId : "default";
  const ctx = (r.pageContext && typeof r.pageContext === "object" ? r.pageContext : {}) as Record<string, unknown>;
  const route = typeof ctx.route === "string" ? ctx.route.slice(0, 200) : "/";
  const projectId = typeof ctx.projectId === "string" && ID.test(ctx.projectId) ? ctx.projectId : undefined;
  const taskId = typeof ctx.taskId === "string" && ID.test(ctx.taskId) ? ctx.taskId : undefined;
  return { ok: true, value: { message, conversationId, pageContext: { route, projectId, taskId } } };
}

/** Agent memory is per user (and per conversation the user starts), never shared. */
export function sessionIdFor(userId: string, conversationId: string, day = new Date().toISOString().slice(0, 10)): string {
  return createHash("sha256").update(`${userId}|${day}|${conversationId}`).digest("hex").slice(0, 64);
}

/** What the tools trust (session attributes) — built only from the token and the server lookup. */
export function sessionAttributesFor(identity: Identity, orgId: string): Record<string, string> {
  return { userId: identity.userId, email: identity.email, orgId, role: identity.role };
}

export const rateKey = (userId: string, now = new Date()) => ({ pk: `RATE#${userId}`, sk: now.toISOString().slice(0, 13) });

/* ------------------------- stream event mapping ------------------------- */

export type StepStatus = "RUNNING" | "OK" | "FORBIDDEN" | "INVALID" | "ERROR";

/** One observable step of an execution: a tool call and its outcome (never the model's hidden reasoning). */
export interface ExecutionStep {
  tool: string;
  label: string;
  status: StepStatus;
  /** Short, content-free description of the outcome ("3 results", "Access refused for your role"). */
  summary: string;
  startedAt: string;
  durationMs?: number;
}

export type ClientEvent =
  | { type: "execution"; executionId: string; agent: string; startedAt: string }
  | { type: "chunk"; text: string }
  | { type: "step"; step: ExecutionStep }
  | { type: "guardrail" }
  | { type: "action"; card: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "done"; status: "COMPLETED" | "FAILED"; durationMs: number };

export const AGENT_NAME = "TeamTask Assistant";

export const TOOL_LABELS = STEP_LABELS;

interface TracePart {
  orchestrationTrace?: {
    invocationInput?: { actionGroupInvocationInput?: { function?: string } };
    observation?: { actionGroupInvocationOutput?: { text?: string } };
  };
  guardrailTrace?: { action?: string };
}

/** Status and a content-free summary of a tool result (counts, refusal, card) — never the data itself. */
export function summariseToolOutput(text: string | undefined): { status: StepStatus; summary: string; card?: unknown } {
  let parsed: { status?: string; data?: unknown; message?: string };
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    return { status: "ERROR", summary: "Unreadable tool result" };
  }
  if (parsed.status === "FORBIDDEN") return { status: "FORBIDDEN", summary: "Access refused for your role" };
  if (parsed.status === "INVALID") return { status: "INVALID", summary: `Request rejected: ${String(parsed.message ?? "invalid parameters").slice(0, 160)}` };
  if (parsed.status !== "OK") return { status: "ERROR", summary: "The data couldn't be read" };
  const data = parsed.data as { card?: unknown; tasks?: unknown[] } | unknown[] | null;
  if (data && !Array.isArray(data) && typeof data === "object" && "card" in data && data.card) return { status: "OK", summary: "Action card prepared (waiting for your confirmation)", card: data.card };
  const count = Array.isArray(data) ? data.length : Array.isArray((data as { tasks?: unknown[] } | null)?.tasks) ? (data as { tasks: unknown[] }).tasks.length : null;
  return { status: "OK", summary: count === null ? "Data returned" : `${count} result${count === 1 ? "" : "s"}` };
}

/**
 * Follows one InvokeAgent stream: pairs each tool call with its result into steps (with status,
 * summary and duration), counts guardrail interventions, and takes action cards ONLY from tool
 * outputs (prepareAction results), never from the model's text, so the model can't forge a card.
 */
export class ExecutionTracker {
  readonly steps: ExecutionStep[] = [];
  guardrailInterventions = 0;
  private open: { step: ExecutionStep; t0: number } | null = null;

  constructor(private readonly clock: () => number = Date.now) {}

  handle(trace: TracePart | undefined): ClientEvent[] {
    const events: ClientEvent[] = [];
    const fn = trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput?.function;
    if (fn) {
      const t0 = this.clock();
      const step: ExecutionStep = { tool: fn, label: TOOL_LABELS[fn] ?? "Using a tool", status: "RUNNING", summary: "Running…", startedAt: new Date(t0).toISOString() };
      this.steps.push(step);
      this.open = { step, t0 };
      events.push({ type: "step", step: { ...step } });
    }
    const output = trace?.orchestrationTrace?.observation?.actionGroupInvocationOutput;
    if (output) {
      const result = summariseToolOutput(output.text);
      if (this.open) {
        Object.assign(this.open.step, { status: result.status, summary: result.summary, durationMs: this.clock() - this.open.t0 });
        events.push({ type: "step", step: { ...this.open.step } });
        this.open = null;
      }
      if (result.card) events.push({ type: "action", card: result.card });
    }
    if (trace?.guardrailTrace?.action === "INTERVENED") {
      this.guardrailInterventions += 1;
      events.push({ type: "guardrail" });
    }
    return events;
  }

  get toolsCalled(): string[] {
    return this.steps.map((s) => s.tool);
  }
}
