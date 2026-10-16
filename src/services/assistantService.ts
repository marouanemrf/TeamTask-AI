import type { ActionType } from "../../amplify/functions/shared/assistantAccess";
import { ApiError } from "./apiError";
import { API_UNAVAILABLE, authorizedFetch, restApiUrl } from "./restApi";

/**
 * Client of the TeamTask assistant: POST {apiUrl}/assistant/chat with the user's Cognito ID token.
 * The answer streams as one JSON object per line (NDJSON):
 *   { "type": "execution", "executionId", "agent", "startedAt" }    first line
 *   { "type": "step", "step": { tool, label, status, summary, startedAt, durationMs? } }   a tool call, then its outcome
 *   { "type": "chunk", "text": "…" }
 *   { "type": "action", "card": ActionCard }    a change the user may confirm (never applied by the assistant)
 *   { "type": "guardrail" }                      the safety filter intervened
 *   { "type": "error", "code", "message" }
 *   { "type": "done", "status": "COMPLETED" | "FAILED", "durationMs" }
 * Identity and permissions come from the token on the server; the body carries only the message and
 * the page the user is on.
 */
export interface ActionCard {
  type: ActionType;
  targetId: string;
  title: string;
  changes: string[];
  params: Record<string, string>;
}

export interface ExecutionStep {
  tool: string;
  label: string;
  status: "RUNNING" | "OK" | "FORBIDDEN" | "INVALID" | "ERROR";
  summary: string;
  startedAt: string;
  durationMs?: number;
}

export type AssistantEvent =
  | { type: "execution"; executionId: string; agent: string; startedAt: string }
  | { type: "step"; step: ExecutionStep }
  | { type: "chunk"; text: string }
  | { type: "action"; card: ActionCard }
  | { type: "guardrail" }
  | { type: "error"; code: string; message: string }
  | { type: "done"; status: "COMPLETED" | "FAILED"; durationMs: number };

export interface PageContext {
  route: string;
  projectId?: string;
  taskId?: string;
}

export const ASSISTANT_UNAVAILABLE = API_UNAVAILABLE;
export const assistantApiUrl = restApiUrl;

export async function streamAssistantChat(
  input: { message: string; conversationId: string; pageContext: PageContext },
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await authorizedFetch("/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.body) throw new ApiError("The assistant sent an empty answer.", "HTTP_502");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as AssistantEvent);
      } catch {
        console.warn("[assistantService] Ignored a malformed stream line");
      }
    }
    if (done) break;
  }
}
