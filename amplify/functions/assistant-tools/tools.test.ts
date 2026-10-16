import { describe, expect, it } from "vitest";
import { ASSISTANT_ROLES, ASSISTANT_TOOLS, ACTIONS_BY_ROLE, TOOL_ROLES } from "../shared/assistantAccess";
import type { AssistantRole, AssistantTool } from "../shared/assistantAccess";
import { runTool } from "./tools";
import type { Caller, DataSource, Params, ToolResult } from "./tools";

const NOW = "2026-10-15";
const iso = (d: string) => `${d}T10:00:00.000Z`;

// Org A: two projects. MEMBER (m1) has tasks in pA1 only. Org B: one project, one task.
const members = [
  { id: "admin", organisationId: "A", name: "Ada Admin", email: "admin@a.test", roles: ["ADMIN"], weeklyCapacityHours: 40 },
  { id: "pm", organisationId: "A", name: "Paul PM", email: "pm@a.test", roles: ["PROJECT_MANAGER"], weeklyCapacityHours: 40 },
  { id: "m1", organisationId: "A", name: "Mia Member", email: "member@a.test", roles: ["MEMBER"], weeklyCapacityHours: 20 },
  { id: "m2", organisationId: "A", name: "Max Member", email: "max@a.test", roles: ["MEMBER"], weeklyCapacityHours: 40 },
  { id: "v", organisationId: "A", name: "Val Viewer", email: "viewer@a.test", roles: ["VIEWER"], weeklyCapacityHours: 40 },
  { id: "b1", organisationId: "B", name: "Bob Other", email: "bob@b.test", roles: ["PROJECT_MANAGER"], weeklyCapacityHours: 40 },
];
const projects = [
  { id: "pA1", organisationId: "A", name: "Cloud hardening", status: "ACTIVE", startDate: "2026-10-01", endDate: "2026-11-30" },
  { id: "pA2", organisationId: "A", name: "ISO roadmap", status: "ACTIVE" },
  { id: "pB", organisationId: "B", name: "Other org project", status: "ACTIVE" },
];
const tasks = [
  { id: "tA1", projectId: "pA1", title: "Review IAM", status: "IN_PROGRESS", priority: "HIGH", dueDate: "2026-10-10", estimatedHours: 30, assigneeId: "m1", description: "secret details", requiredSkills: ["IAM"] },
  { id: "tA2", projectId: "pA1", title: "Harden S3", status: "TODO", priority: "MEDIUM", dueDate: "2026-10-17", estimatedHours: 8, assigneeId: "m2", description: "m2 notes" },
  { id: "tA3", projectId: "pA2", title: "Gap analysis", status: "TODO", priority: "HIGH", dueDate: "2026-11-01", estimatedHours: 16, assigneeId: "m2" },
  { id: "tA4", projectId: "pA1", title: "Done thing", status: "DONE", assigneeId: "m1" },
  { id: "tB", projectId: "pB", title: "Org B secret task", status: "TODO", dueDate: "2026-10-01", estimatedHours: 99, assigneeId: "b1" },
];
const dependencies = [{ fromTaskId: "tA1", toTaskId: "tA2" }];
const reports = [
  { id: "rA", projectId: "pA1", year: 2026, weekNumber: 41, summary: "Week 41", risks: ["IAM late"], correctiveActions: ["Reassign"], totalCount: 3, completedCount: 1, overdueCount: 1, completionRate: 33 },
  { id: "rB", projectId: "pB", year: 2026, weekNumber: 41, summary: "Org B report", risks: [], correctiveActions: [] },
];
const escalations = [
  { id: "eA", taskId: "tA1", status: "OPEN", reason: "5 days late", createdAt: iso("2026-10-14") },
  { id: "eB", taskId: "tB", status: "OPEN", reason: "Org B late", createdAt: iso("2026-10-14") },
];
const events = [
  { id: "ev1", entityId: "tA1", eventType: "STATUS_CHANGED", actorType: "USER", actorEmail: "member@a.test", createdAt: new Date(Date.now() - 86_400_000).toISOString() },
  { id: "ev2", entityId: "tB", eventType: "CREATED", actorType: "USER", actorEmail: "bob@b.test", createdAt: new Date(Date.now() - 86_400_000).toISOString() },
];
const activity = [
  { orgId: "A", at: new Date().toISOString(), kind: "TOOL", tool: "getMyTasks", role: "MEMBER", allowed: true, durationMs: 12 },
  { orgId: "A", at: new Date().toISOString(), kind: "SESSION", outcome: "OK", guardrailInterventions: 1, toolsCalled: ["getMyTasks"] },
  { orgId: "B", at: new Date().toISOString(), kind: "TOOL", tool: "getAuditEvents", role: "ADMIN", allowed: true },
];

// The data source returns everything unfiltered: organisation filtering must happen in the tools.
const ds: DataSource = {
  members: async () => members,
  projects: async () => projects,
  project: async (id) => projects.find((p) => p.id === id) ?? null,
  tasks: async () => tasks,
  task: async (id) => tasks.find((t) => t.id === id) ?? null,
  dependencies: async () => dependencies,
  reports: async () => reports,
  openEscalations: async () => escalations,
  events: async () => events,
  activity: async () => activity,
};

const CALLERS: Record<AssistantRole, Caller> = {
  ADMIN: { userId: "u-admin", email: "admin@a.test", orgId: "A", role: "ADMIN" },
  PROJECT_MANAGER: { userId: "u-pm", email: "pm@a.test", orgId: "A", role: "PROJECT_MANAGER" },
  MEMBER: { userId: "u-m1", email: "member@a.test", orgId: "A", role: "MEMBER" },
  VIEWER: { userId: "u-v", email: "viewer@a.test", orgId: "A", role: "VIEWER" },
};
const run = (role: AssistantRole, tool: string, params: Params = {}) => runTool(ds, CALLERS[role], tool, params, NOW);
const data = <T,>(r: ToolResult) => (r.status === "OK" ? (r.data as T) : (() => { throw new Error(`expected OK, got ${JSON.stringify(r)}`); })());
const json = (r: ToolResult) => JSON.stringify(r);

/** Valid org A parameters for each tool, within what the strictest allowed role may see. */
const PARAMS: Record<AssistantTool, Params> = {
  getMyTasks: {},
  getProjectStatus: { projectId: "pA1" },
  getProjectTasks: { projectId: "pA1" },
  getTaskDetails: { taskId: "tA1" },
  getWeeklyReports: { projectId: "pA1" },
  getTeamWorkload: {},
  getRisksAndDelays: {},
  getEscalations: {},
  getAuditEvents: { days: "7" },
  getAgentActivity: { days: "7" },
  prepareAction: { type: "CHANGE_MY_TASK_STATUS", targetId: "tA1", params: JSON.stringify({ status: "TODO" }) },
};
/** The caller of prepareAction must be the assignee of tA1: run it as the member's email for every role. */
const asAssignee = (role: AssistantRole): Caller => ({ ...CALLERS[role], email: "member@a.test" });

describe("permission matrix: every tool × every role", () => {
  for (const tool of ASSISTANT_TOOLS) {
    for (const role of ASSISTANT_ROLES) {
      const allowed = TOOL_ROLES[tool].includes(role);
      it(`${tool} as ${role} → ${allowed ? "OK" : "FORBIDDEN"}`, async () => {
        const caller = tool === "prepareAction" ? asAssignee(role) : CALLERS[role];
        const result = await runTool(ds, caller, tool, PARAMS[tool], NOW);
        expect(result.status).toBe(allowed ? "OK" : "FORBIDDEN");
      });
    }
  }
});

describe("organisation isolation", () => {
  const foreign: Array<[AssistantTool, Params]> = [
    ["getProjectStatus", { projectId: "pB" }],
    ["getProjectTasks", { projectId: "pB" }],
    ["getTaskDetails", { taskId: "tB" }],
    ["getWeeklyReports", { projectId: "pB" }],
    ["getTeamWorkload", { projectId: "pB" }],
    ["getRisksAndDelays", { projectId: "pB" }],
    ["prepareAction", { type: "START_PLANNING", targetId: "pB" }],
    ["prepareAction", { type: "CHANGE_DUE_DATE", targetId: "tB", params: '{"dueDate":"2026-12-01"}' }],
  ];
  for (const [tool, params] of foreign) {
    it(`${tool} on another organisation's record → FORBIDDEN for every role`, async () => {
      for (const role of ASSISTANT_ROLES) expect((await run(role, tool, params)).status).toBe("FORBIDDEN");
    });
  }

  it("an unknown id gives exactly the same answer as another organisation's id", async () => {
    expect(json(await run("ADMIN", "getTaskDetails", { taskId: "does-not-exist" }))).toBe(json(await run("ADMIN", "getTaskDetails", { taskId: "tB" })));
    expect(json(await run("PROJECT_MANAGER", "getProjectTasks", { projectId: "nope" }))).toBe(json(await run("PROJECT_MANAGER", "getProjectTasks", { projectId: "pB" })));
  });

  it("lists never contain another organisation's data", async () => {
    for (const role of ASSISTANT_ROLES) {
      for (const tool of ASSISTANT_TOOLS.filter((t) => TOOL_ROLES[t].includes(role) && t !== "prepareAction")) {
        const params = tool === "getProjectStatus" || tool === "getTeamWorkload" || tool === "getRisksAndDelays" ? {} : PARAMS[tool];
        const text = json(await run(role, tool, params));
        expect(text, `${tool} as ${role}`).not.toMatch(/Org B|Other org|Bob Other|bob@b\.test/);
      }
    }
  });

  it("a caller without an organisation gets nothing", async () => {
    const r = await runTool(ds, { ...CALLERS.ADMIN, orgId: null }, "getProjectStatus", {}, NOW);
    expect(r.status).toBe("FORBIDDEN");
  });

  it("an orgId passed as a tool parameter is ignored", async () => {
    const r = await run("ADMIN", "getProjectStatus", { projectId: "pB", orgId: "B" } as Params);
    expect(r.status).toBe("FORBIDDEN");
  });
});

describe("finer rules per role", () => {
  it("MEMBER: only projects where they have a task, limited fields", async () => {
    expect((await run("MEMBER", "getProjectTasks", { projectId: "pA2" })).status).toBe("FORBIDDEN");
    const rows = data<{ tasks: Record<string, unknown>[] }>(await run("MEMBER", "getProjectTasks", { projectId: "pA1" })).tasks;
    expect(rows.length).toBe(3);
    expect(Object.keys(rows[0]).sort()).toEqual(["assignee", "dueDate", "id", "status", "title"]);
  });

  it("MEMBER: details of a colleague's task in their project are limited; other projects are refused", async () => {
    const other = data<Record<string, unknown>>(await run("MEMBER", "getTaskDetails", { taskId: "tA2" }));
    expect(other.description).toBeUndefined();
    expect(json(await run("MEMBER", "getTaskDetails", { taskId: "tA2" }))).not.toContain("m2 notes");
    expect((await run("MEMBER", "getTaskDetails", { taskId: "tA3" })).status).toBe("FORBIDDEN");
    expect(data<Record<string, unknown>>(await run("MEMBER", "getTaskDetails", { taskId: "tA1" })).description).toBe("secret details");
  });

  it("MEMBER: own tasks only in getMyTasks and getRisksAndDelays", async () => {
    const mine = data<{ title: string }[]>(await run("MEMBER", "getMyTasks", { filter: "all" }));
    expect(mine.map((t) => t.title).sort()).toEqual(["Done thing", "Review IAM"]);
    const risks = data<{ title: string; assignee?: string }[]>(await run("MEMBER", "getRisksAndDelays"));
    expect(risks.map((r) => r.title)).toEqual(["Review IAM"]);
    expect(risks[0].assignee).toBeUndefined();
  });

  it("VIEWER: aggregates only (no task titles, no risks)", async () => {
    const status = data<Record<string, unknown>[]>(await run("VIEWER", "getProjectStatus", { projectId: "pA1" }))[0];
    expect(status.overdueTasks).toBeUndefined();
    expect(status.taskCounts).toMatchObject({ total: 3, done: 1, overdue: 1 });
    const report = data<Record<string, unknown>[]>(await run("VIEWER", "getWeeklyReports", { projectId: "pA1" }))[0];
    expect(report.risks).toBeUndefined();
    expect(json(await run("VIEWER", "getProjectStatus", {}))).not.toContain("Review IAM");
  });

  it("PROJECT_MANAGER: workload and escalations of the organisation only", async () => {
    const load = data<{ name: string; loadPercent: number | null }[]>(await run("PROJECT_MANAGER", "getTeamWorkload"));
    expect(load[0]).toMatchObject({ name: "Mia Member", loadPercent: 150 });
    expect(load.map((l) => l.name)).not.toContain("Bob Other");
    const esc = data<{ task: string }[]>(await run("PROJECT_MANAGER", "getEscalations"));
    expect(esc.map((e) => e.task)).toEqual(["Review IAM"]);
  });

  it("ADMIN: audit events and assistant activity of the organisation only", async () => {
    const audit = data<{ entity: string }[]>(await run("ADMIN", "getAuditEvents"));
    expect(audit.map((a) => a.entity)).toEqual(["Review IAM"]);
    const act = data<{ tools: { tool: string }[]; conversations: number; guardrailInterventions: number }>(await run("ADMIN", "getAgentActivity"));
    expect(act).toMatchObject({ conversations: 1, guardrailInterventions: 1 });
    expect(act.tools.map((t) => t.tool)).toEqual(["getMyTasks"]);
  });
});

describe("prepareAction: cards only, validated", () => {
  const prepare = (role: AssistantRole, type: string, targetId: string, params: object = {}, caller?: Caller) =>
    runTool(ds, caller ?? CALLERS[role], "prepareAction", { type, targetId, params: JSON.stringify(params) }, NOW);

  it("allowed card types follow the role table", async () => {
    for (const role of ASSISTANT_ROLES) {
      for (const type of ["ASSIGN_TASK", "CHANGE_DUE_DATE", "START_PLANNING"]) {
        const r = await prepare(role, type, type === "START_PLANNING" ? "pA1" : "tA2", { assigneeId: "m1", dueDate: "2026-12-01" });
        expect(r.status, `${type} as ${role}`).toBe((ACTIONS_BY_ROLE[role] as readonly string[]).includes(type) ? "OK" : "FORBIDDEN");
      }
    }
  });

  it("VIEWER never gets a card", async () => {
    for (const type of ["CHANGE_MY_TASK_STATUS", "REPORT_BLOCKER", "ASSIGN_TASK", "CHANGE_DUE_DATE", "START_PLANNING"]) {
      expect((await prepare("VIEWER", type, "tA1", { status: "TODO", reason: "a long enough reason" }, asAssignee("VIEWER"))).status).toBe("FORBIDDEN");
    }
  });

  it("MEMBER: own task only; a blocker needs a reason; dependencies are checked", async () => {
    expect((await prepare("MEMBER", "CHANGE_MY_TASK_STATUS", "tA2", { status: "IN_PROGRESS" })).status).toBe("FORBIDDEN");
    expect((await prepare("MEMBER", "REPORT_BLOCKER", "tA1", { reason: "short" })).status).toBe("INVALID");
    const blocked = await prepare("MEMBER", "REPORT_BLOCKER", "tA1", { reason: "Waiting for read-only access" });
    expect(blocked).toMatchObject({ status: "OK", data: { card: { type: "REPORT_BLOCKER", targetId: "tA1", params: { status: "BLOCKED", reason: "Waiting for read-only access" } } } });
    const done = await prepare("MEMBER", "CHANGE_MY_TASK_STATUS", "tA1", { status: "DONE" });
    expect(done.status).toBe("INVALID");
  });

  it("ASSIGN_TASK: only to an assignable member of the same organisation", async () => {
    expect((await prepare("PROJECT_MANAGER", "ASSIGN_TASK", "tA2", { assigneeId: "b1" })).status).toBe("INVALID");
    expect((await prepare("PROJECT_MANAGER", "ASSIGN_TASK", "tA2", { assigneeId: "v" })).status).toBe("INVALID");
    expect(await prepare("PROJECT_MANAGER", "ASSIGN_TASK", "tA2", { assigneeName: "mia member" })).toMatchObject({ status: "OK", data: { card: { params: { assigneeId: "m1" } } } });
  });

  it("CHANGE_DUE_DATE validates the date; closed tasks are refused", async () => {
    expect((await prepare("ADMIN", "CHANGE_DUE_DATE", "tA2", { dueDate: "2026-13-45" })).status).toBe("INVALID");
    expect((await prepare("ADMIN", "CHANGE_DUE_DATE", "tA4", { dueDate: "2026-12-01" })).status).toBe("FORBIDDEN");
  });
});
