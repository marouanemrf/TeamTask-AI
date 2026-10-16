import "./amplifyConfig";
import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import type { ActionType } from "../../amplify/functions/shared/assistantAccess";
import { ApiError } from "./apiError";

/**
 * Client of the TeamTask assistant: POST {apiUrl}/assistant/chat with the user's Cognito ID token.
 * The answer streams as one JSON object per line (NDJSON):
 *   { "type": "chunk", "text": "…" }
 *   { "type": "trace", "step": "getTeamWorkload", "label": "Computing the team's workload" }
 *   { "type": "action", "card": ActionCard }    a change the user may confirm (never applied by the assistant)
 *   { "type": "error", "code": "…", "message": "…" }
 *   { "type": "done" }
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

export type AssistantEvent =
  | { type: "chunk"; text: string }
  | { type: "trace"; step: string; label: string }
  | { type: "action"; card: ActionCard }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export interface PageContext {
  route: string;
  projectId?: string;
  taskId?: string;
}

export const ASSISTANT_UNAVAILABLE = "ASSISTANT_UNAVAILABLE";

interface ApiOutputs {
  custom?: { teamtaskApi?: { url?: string } };
}

/** REST API base URL: amplify_outputs.json (custom.teamtaskApi.url), or VITE_API_URL to target another stage. */
export function assistantApiUrl(): string | null {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  const url = fromEnv || (outputs as ApiOutputs).custom?.teamtaskApi?.url;
  return url ? url.replace(/\/$/, "") : null;
}

export async function streamAssistantChat(
  input: { message: string; conversationId: string; pageContext: PageContext },
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = assistantApiUrl();
  if (!base) throw new ApiError("The assistant isn't deployed in this environment yet.", ASSISTANT_UNAVAILABLE);
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken?.toString();
  if (!token) throw new ApiError("Your session has expired. Sign in again.", "HTTP_401");

  const response = await fetch(`${base}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", Authorization: token },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) {
    let body: { error?: { code?: string; message?: string }; message?: string } = {};
    try {
      body = await response.json();
    } catch {
      /* not JSON */
    }
    const message =
      body.error?.message ??
      (response.status === 429 ? "You've sent too many messages. Try again later." : response.status === 401 ? "Your session has expired. Sign in again." : `The assistant request failed (${response.status}).`);
    throw new ApiError(message, `HTTP_${response.status}`);
  }

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
