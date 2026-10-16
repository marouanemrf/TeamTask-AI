import { describe, expect, it } from "vitest";
import { ExecutionTracker, identityFromClaims, MAX_MESSAGE, parseChatRequest, sessionAttributesFor, sessionIdFor, summariseToolOutput } from "./chatCore";

describe("identity comes only from the token claims", () => {
  it("reads sub, email and the highest role from cognito:groups", () => {
    expect(identityFromClaims({ sub: "u1", email: "A@B.test", "cognito:groups": "MEMBER,PROJECT_MANAGER" })).toMatchObject({ userId: "u1", email: "a@b.test", role: "PROJECT_MANAGER" });
    expect(identityFromClaims({ sub: "u1", email: "a@b.test", "cognito:groups": "[ADMIN MEMBER]" })?.role).toBe("ADMIN");
    expect(identityFromClaims({ sub: "u1", email: "a@b.test" })?.role).toBe("VIEWER");
  });
  it("reads email_verified from the token (string claim)", () => {
    expect(identityFromClaims({ sub: "u1", email: "a@b.test", email_verified: "true" })?.emailVerified).toBe(true);
    expect(identityFromClaims({ sub: "u1", email: "a@b.test", email_verified: "false" })?.emailVerified).toBe(false);
    expect(identityFromClaims({ sub: "u1", email: "a@b.test" })?.emailVerified).toBe(false);
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
    const attrs = sessionAttributesFor({ userId: "u1", email: "m@a.test", emailVerified: true, role: "MEMBER", groups: ["MEMBER"] }, "org-a");
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

describe("execution tracking", () => {
  const call = (fn: string) => ({ orchestrationTrace: { invocationInput: { actionGroupInvocationInput: { function: fn } } } });
  const result = (body: unknown) => ({ orchestrationTrace: { observation: { actionGroupInvocationOutput: { text: JSON.stringify(body) } } } });

  it("pairs each tool call with its result: status, content-free summary, duration", () => {
    let now = 1_000;
    const tracker = new ExecutionTracker(() => now);
    expect(tracker.handle(call("getMyTasks"))).toEqual([{ type: "step", step: { tool: "getMyTasks", label: "Reading your tasks", status: "RUNNING", summary: "Running…", startedAt: new Date(1000).toISOString() } }]);
    now = 1_250;
    expect(tracker.handle(result({ status: "OK", data: [{ title: "secret title" }, { title: "x" }] }))).toEqual([{ type: "step", step: { tool: "getMyTasks", label: "Reading your tasks", status: "OK", summary: "2 results", startedAt: new Date(1000).toISOString(), durationMs: 250 } }]);
    tracker.handle(call("getTeamWorkload"));
    tracker.handle(result({ status: "FORBIDDEN" }));
    expect(tracker.steps.map((s) => `${s.tool}:${s.status}:${s.summary}`)).toEqual(["getMyTasks:OK:2 results", "getTeamWorkload:FORBIDDEN:Access refused for your role"]);
    expect(JSON.stringify(tracker.steps)).not.toContain("secret title");
  });

  it("action cards come only from tool outputs", () => {
    const card = { type: "REPORT_BLOCKER", targetId: "t1", title: "x", changes: [], params: {} };
    const tracker = new ExecutionTracker();
    tracker.handle(call("prepareAction"));
    const events = tracker.handle(result({ status: "OK", data: { card } }));
    expect(events).toContainEqual({ type: "action", card });
    expect(tracker.steps[0].summary).toBe("Action card prepared (waiting for your confirmation)");
    expect(new ExecutionTracker().handle(result({ status: "FORBIDDEN" }))).toEqual([]);
  });

  it("counts guardrail interventions and summarises errors", () => {
    const tracker = new ExecutionTracker();
    expect(tracker.handle({ guardrailTrace: { action: "INTERVENED" } })).toEqual([{ type: "guardrail" }]);
    expect(tracker.guardrailInterventions).toBe(1);
    expect(summariseToolOutput("not json").status).toBe("ERROR");
    expect(summariseToolOutput(JSON.stringify({ status: "INVALID", message: "dueDate must be YYYY-MM-DD" })).summary).toBe("Request rejected: dueDate must be YYYY-MM-DD");
  });
});
