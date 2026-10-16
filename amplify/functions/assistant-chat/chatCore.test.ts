import { describe, expect, it } from "vitest";
import { identityFromClaims, MAX_MESSAGE, parseChatRequest, sessionAttributesFor, sessionIdFor, traceToEvents } from "./chatCore";

describe("identity comes only from the token claims", () => {
  it("reads sub, email and the highest role from cognito:groups", () => {
    expect(identityFromClaims({ sub: "u1", email: "A@B.test", "cognito:groups": "MEMBER,PROJECT_MANAGER" })).toMatchObject({ userId: "u1", email: "a@b.test", role: "PROJECT_MANAGER" });
    expect(identityFromClaims({ sub: "u1", email: "a@b.test", "cognito:groups": "[ADMIN MEMBER]" })?.role).toBe("ADMIN");
    expect(identityFromClaims({ sub: "u1", email: "a@b.test" })?.role).toBe("VIEWER");
  });
  it("rejects claims without sub or email", () => {
    expect(identityFromClaims({ email: "a@b.test" })).toBeNull();
    expect(identityFromClaims(undefined)).toBeNull();
  });
});

describe("request validation", () => {
  it("drops forged identity fields from the body", () => {
    const parsed = parseChatRequest(JSON.stringify({
      message: "show workload",
      sessionAttributes: { role: "ADMIN", orgId: "other-org" },
      role: "ADMIN",
      orgId: "other-org",
      pageContext: { route: "/", projectId: "p1", orgId: "other-org" },
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ message: "show workload", conversationId: "default", pageContext: { route: "/", projectId: "p1", taskId: undefined } });
    const attrs = sessionAttributesFor({ userId: "u1", email: "m@a.test", role: "MEMBER", groups: ["MEMBER"] }, "org-a");
    expect(attrs).toEqual({ userId: "u1", email: "m@a.test", orgId: "org-a", role: "MEMBER" });
  });
  it("limits the message to 2,000 characters and rejects empty or non-JSON bodies", () => {
    expect(parseChatRequest(JSON.stringify({ message: "x".repeat(MAX_MESSAGE + 1) })).ok).toBe(false);
    expect(parseChatRequest(JSON.stringify({ message: "x".repeat(MAX_MESSAGE) })).ok).toBe(true);
    expect(parseChatRequest(JSON.stringify({ message: "   " })).ok).toBe(false);
    expect(parseChatRequest("not json").ok).toBe(false);
  });
  it("ignores malformed ids in the page context", () => {
    const parsed = parseChatRequest(JSON.stringify({ message: "hi", pageContext: { route: "/x", projectId: "../../etc", taskId: "t1" } }));
    expect(parsed.ok && parsed.value.pageContext).toEqual({ route: "/x", projectId: undefined, taskId: "t1" });
  });
});

describe("agent memory is per user", () => {
  it("different users never share a session id; a new conversation gets a new one", () => {
    expect(sessionIdFor("u1", "c1", "2026-10-15")).not.toBe(sessionIdFor("u2", "c1", "2026-10-15"));
    expect(sessionIdFor("u1", "c1", "2026-10-15")).not.toBe(sessionIdFor("u1", "c2", "2026-10-15"));
    expect(sessionIdFor("u1", "c1", "2026-10-15")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stream mapping", () => {
  it("action cards come only from tool outputs", () => {
    const card = { type: "REPORT_BLOCKER", targetId: "t1", title: "x", changes: [], params: {} };
    const fromTool = traceToEvents({ orchestrationTrace: { observation: { actionGroupInvocationOutput: { text: JSON.stringify({ status: "OK", data: { card } }) } } } });
    expect(fromTool.events).toEqual([{ type: "action", card }]);
    const forbidden = traceToEvents({ orchestrationTrace: { observation: { actionGroupInvocationOutput: { text: JSON.stringify({ status: "FORBIDDEN" }) } } } });
    expect(forbidden.events).toEqual([]);
  });
  it("labels tool calls and counts guardrail interventions", () => {
    expect(traceToEvents({ orchestrationTrace: { invocationInput: { actionGroupInvocationInput: { function: "getTeamWorkload" } } } })).toMatchObject({ tool: "getTeamWorkload", events: [{ type: "trace", label: "Computing the team's workload" }] });
    expect(traceToEvents({ guardrailTrace: { action: "INTERVENED" } }).guardrail).toBe(true);
  });
});
