import { describe, expect, it } from "vitest";
import { M, Q } from "./documents";
import { as, enabled, fx, isDenied, isDeniedOrHidden, record, summary, uuid } from "./helpers";
import type { GqlResult } from "./helpers";

/** Org B's project manager must never read or change org A's data (by id or through lists). */
describe.skipIf(!enabled)("c. cross-tenant isolation (org B manager → org A)", () => {
  const byId: Array<[string, string, () => Promise<GqlResult>, string]> = [
    ["read org A project by id", "getProject", () => as("B_PM", Q.getProject, { id: fx.projects.A.id }), "getProject"],
    ["read org A task by id", "getTask", () => as("B_PM", Q.getTask, { id: fx.tasks.A.id }), "getTask"],
    ["read org A member (email, phone) by id", "getTeamMember", () => as("B_PM", Q.getTeamMember, { id: fx.users.A_MEMBER.memberId }), "getTeamMember"],
    ["update org A project", "updateProject", () => as("B_PM", M.updateProject, { input: { id: fx.projects.A.id, name: fx.projects.A.name } }), "updateProject"],
    ["add a milestone to org A project", "createMilestone", () => as("B_PM", M.createMilestone, { input: { projectId: fx.projects.A.id, name: "sec cross-tenant" } }), "createMilestone"],
    ["create a task in org A project", "addTask", () => as("B_PM", M.addTask, { clientRequestId: uuid(), projectId: fx.projects.A.id, title: "sec cross-tenant", assigneeId: fx.users.A_MEMBER.memberId }), "addTask"],
    ["edit org A task", "editTask", () => as("B_PM", M.editTask, { clientRequestId: uuid(), taskId: fx.tasks.A.id, title: "Security test task A", assigneeId: fx.users.A_MEMBER.memberId }), "editTask"],
    ["assign org A task", "assignTask", () => as("B_PM", M.assignTask, { clientRequestId: uuid(), taskId: fx.tasks.A.id, assigneeId: fx.users.A_MEMBER.memberId }), "assignTask"],
    ["change org A task status", "changeTaskStatus", () => as("B_PM", M.changeTaskStatus, { clientRequestId: uuid(), taskId: fx.tasks.A.id, status: "TODO" }), "changeTaskStatus"],
    ["assign org A task to an org B member", "assignTask", () => as("B_PM", M.assignTask, { clientRequestId: uuid(), taskId: fx.tasks.A.id, assigneeId: fx.users.B_PM.memberId }), "assignTask"],
    ["cancel org A task", "cancelTask", () => as("B_PM", M.cancelTask, { clientRequestId: uuid(), taskId: fx.tasks.A.id }), "cancelTask"],
    ["audit an org A entity", "logEvent", () => as("B_PM", M.logEvent, { clientRequestId: uuid(), entityId: fx.projects.A.id, eventType: "UPDATED" }), "logEvent"],
    ["edit an org A team member", "manageTeamMember", () => as("B_PM", M.manageTeamMember, { action: "UPDATE", memberId: fx.users.A_VIEWER.memberId, organisationId: fx.orgAId, name: "Security A_VIEWER", email: fx.users.A_VIEWER.email, username: "sec-a-viewer", roles: ["VIEWER"], weeklyCapacityHours: 40 }), "manageTeamMember"],
    ["create a recommendation on org A project", "createAIRecommendation", () => as("B_PM", M.createAIRecommendation, { input: { projectId: fx.projects.A.id, type: "PLAN", status: "PENDING" } }), "createAIRecommendation"],
  ];

  for (const [label, op, call, field] of byId) {
    it(label, async () => {
      const r = await call();
      const pass = isDeniedOrHidden(r, field);
      record({ category: "c. Cross-tenant", name: label, request: `${op} as org B PROJECT_MANAGER on org A id`, expected: "403/401 or NOT_FOUND, no org A data", actual: summary(r), pass });
      expect(pass).toBe(true);
    });
  }

  const lists: Array<[string, string, string, (item: Record<string, unknown>) => boolean]> = [
    ["listProjects", Q.listProjects, "listProjects", (p) => p.organisationId === fx.orgAId],
    ["listTasks", Q.listTasks, "listTasks", (t) => t.projectId === fx.projects.A.id],
    ["listTeamMembers", Q.listTeamMembers, "listTeamMembers", (m) => m.organisationId === fx.orgAId],
  ];
  for (const [name, doc, field, isOrgA] of lists) {
    it(`${name} never returns org A items`, async () => {
      const r = await as("B_PM", doc);
      const items = ((r.data?.[field] as { items?: Record<string, unknown>[] } | null)?.items ?? []);
      const leaked = items.filter(isOrgA).length;
      const pass = isDenied(r) || leaked === 0;
      record({ category: "c. Cross-tenant", name: `${name} as org B`, request: `${name} as org B PROJECT_MANAGER`, expected: "0 org A items", actual: `${summary(r)} · ${leaked} org A item(s) of ${items.length}`, pass });
      expect(pass).toBe(true);
    });
  }

  it("org A task unchanged after the attempts", async () => {
    const r = await as("A_ADMIN", Q.getTask, { id: fx.tasks.A.id });
    const task = r.data?.getTask as { status?: string; assigneeId?: string } | null;
    const pass = task?.status !== "CANCELLED" && task?.assigneeId === fx.users.A_MEMBER.memberId;
    record({ category: "c. Cross-tenant", name: "org A task intact", request: "getTask as org A ADMIN", expected: "not cancelled, still assigned to the org A member", actual: JSON.stringify(task), pass });
    expect(pass).toBe(true);
  });
});
