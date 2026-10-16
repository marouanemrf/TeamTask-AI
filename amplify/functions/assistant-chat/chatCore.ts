import { createHash } from "node:crypto";
import { primaryAssistantRole } from "../shared/assistantAccess";
import type { AssistantRole } from "../shared/assistantAccess";

/** Pure parts of POST /assistant/chat (identity, validation, session, stream mapping), unit-tested. */

export const MAX_MESSAGE = 2000;
export const RATE_LIMIT_PER_HOUR = 30;
const ID = /^[A-Za-z0-9:_-]{1,128}$/;

export interface Identity {
  userId: string;
  email: string;
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
  return { userId, email, role: primaryAssistantRole(groups), groups };
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

export type ClientEvent =
  | { type: "chunk"; text: string }
  | { type: "trace"; step: string; label: string }
  | { type: "action"; card: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

const TOOL_LABELS: Record<string, string> = {
  getMyTasks: "Reading your tasks",
  getProjectStatus: "Reading the project status",
  getProjectTasks: "Reading the project's tasks",
  getTaskDetails: "Reading the task",
  getWeeklyReports: "Reading the weekly reports",
  getTeamWorkload: "Computing the team's workload",
  getRisksAndDelays: "Looking for risks and delays",
  getEscalations: "Reading the escalations",
  getAuditEvents: "Reading the audit trail",
  getAgentActivity: "Reading the assistant's activity",
  prepareAction: "Preparing an action for you to confirm",
};

interface TracePart {
  orchestrationTrace?: {
    invocationInput?: { actionGroupInvocationInput?: { function?: string } };
    observation?: { actionGroupInvocationOutput?: { text?: string } };
  };
  guardrailTrace?: { action?: string };
}

/**
 * Turns one InvokeAgent trace into client events. Action cards are taken ONLY from tool outputs
 * (prepareAction results), never from the model's text, so the model can't forge a card.
 */
export function traceToEvents(trace: TracePart | undefined): { events: ClientEvent[]; tool?: string; guardrail: boolean } {
  const events: ClientEvent[] = [];
  const fn = trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput?.function;
  if (fn) events.push({ type: "trace", step: fn, label: TOOL_LABELS[fn] ?? "Using a tool" });
  const output = trace?.orchestrationTrace?.observation?.actionGroupInvocationOutput?.text;
  if (output) {
    try {
      const parsed = JSON.parse(output) as { status?: string; data?: { card?: unknown } };
      if (parsed.status === "OK" && parsed.data?.card) events.push({ type: "action", card: parsed.data.card });
    } catch {
      /* not a tool result we produce */
    }
  }
  const guardrail = trace?.guardrailTrace?.action === "INTERVENED";
  if (guardrail) events.push({ type: "trace", step: "guardrail", label: "Safety filter applied" });
  return { events, tool: fn, guardrail };
}
