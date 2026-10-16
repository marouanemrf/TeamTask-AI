import "./amplifyConfig";
import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import { ApiError } from "./apiError";

/**
 * Client of the AI planning assistant (Amazon Bedrock Agent behind API Gateway).
 *
 * POST {apiUrl}/projects/{projectId}/agent/plan with { message, sessionId } streams one JSON object
 * per line (NDJSON):
 *   { "type": "trace", "step": "getTeamSkills", "label": "Reading the team's skills" }
 *   { "type": "chunk", "text": "…" }                       part of the answer
 *   { "type": "recommendation", "recommendationId": "…" }  a plan was submitted for approval
 *   { "type": "error", "code": "…", "message": "…" }
 *   { "type": "done" }
 * The agent only proposes: nothing is applied without a manager's approval.
 */
export type AgentStreamEvent =
  | { type: "trace"; step: string; label: string }
  | { type: "chunk"; text: string }
  | { type: "recommendation"; recommendationId: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export const AGENT_UNAVAILABLE = "AGENT_UNAVAILABLE";

interface ApiOutputs {
  custom?: { teamtaskApi?: { url?: string } };
}

/** REST API base URL: amplify_outputs.json (custom.teamtaskApi.url), or VITE_API_URL to target another stage. */
export function agentApiUrl(): string | null {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  const fromOutputs = (outputs as ApiOutputs).custom?.teamtaskApi?.url;
  const url = fromEnv || fromOutputs;
  return url ? url.replace(/\/$/, "") : null;
}

/** Sends one message to the assistant and calls `onEvent` for every streamed event. */
export async function streamAgentPlan(
  projectId: string,
  message: string,
  sessionId: string,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = agentApiUrl();
  if (!base) throw new ApiError("The AI assistant isn't deployed yet.", AGENT_UNAVAILABLE);
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken?.toString();
  if (!token) throw new ApiError("Your session has expired. Sign in again.", "Unauthorized");

  const response = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/agent/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", Authorization: token },
    body: JSON.stringify({ message, sessionId }),
    signal,
  });
  if (!response.ok || !response.body) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await response.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(body.error?.message ?? `The assistant request failed (${response.status}).`, body.error?.code ?? `HTTP_${response.status}`);
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
        onEvent(JSON.parse(line) as AgentStreamEvent);
      } catch {
        console.warn("[agentService] Ignored a malformed stream line");
      }
    }
    if (done) break;
  }
}
