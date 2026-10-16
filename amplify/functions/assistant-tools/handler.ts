import { createHash } from "node:crypto";
import { ASSISTANT_ROLES } from "../shared/assistantAccess";
import type { AssistantRole } from "../shared/assistantAccess";
import { recordActivity } from "../shared/assistantActivity";
import { dynamoSource } from "./dynamoSource";
import { runTool } from "./tools";
import type { Caller, Params } from "./tools";

/** Tool call from assistant-chat (same shape as a Bedrock Agents action group event). */
interface AgentToolEvent {
  messageVersion: string;
  actionGroup: string;
  function: string;
  parameters?: { name: string; type: string; value: string }[];
  sessionAttributes?: Record<string, string>;
  promptSessionAttributes?: Record<string, string>;
}

/**
 * Tools of the TeamTask assistant, invoked only by assistant-chat (lambda:InvokeFunction is granted
 * to that function alone). The caller's identity comes ONLY from the session attributes, which
 * assistant-chat sets from the Cognito token; the model only chooses the tool and its parameters.
 * Every call is logged as activity (tool, role, allowed, duration) without content.
 */
export const handler = async (event: AgentToolEvent) => {
  const started = Date.now();
  const attrs = event.sessionAttributes ?? {};
  const role = (ASSISTANT_ROLES as readonly string[]).includes(attrs.role) ? (attrs.role as AssistantRole) : "VIEWER";
  const caller: Caller = {
    userId: attrs.userId ?? "",
    email: (attrs.email ?? "").toLowerCase(),
    orgId: attrs.orgId || null,
    role,
  };
  const params: Params = {};
  for (const p of event.parameters ?? []) {
    if (["filter", "projectId", "taskId", "entityId", "days", "type", "targetId", "params"].includes(p.name)) params[p.name as keyof Params] = String(p.value).slice(0, 2000);
  }

  let body: string;
  let allowed = false;
  try {
    if (!caller.userId || !caller.email) throw new Error("missing session identity");
    const result = await runTool(dynamoSource, caller, event.function, params);
    allowed = result.status !== "FORBIDDEN";
    body = JSON.stringify(result);
  } catch (error) {
    console.error(JSON.stringify({ fn: "assistant-tools", tool: event.function, error: error instanceof Error ? error.message : String(error) }));
    body = JSON.stringify({ status: "ERROR", message: "The data could not be read. Try again later." });
  }

  if (caller.orgId) {
    await recordActivity({
      orgId: caller.orgId,
      kind: "TOOL",
      role,
      userHash: createHash("sha256").update(caller.userId).digest("hex").slice(0, 16),
      tool: event.function,
      allowed,
      durationMs: Date.now() - started,
    });
  }

  return {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: { responseBody: { TEXT: { body } } },
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes,
  };
};
