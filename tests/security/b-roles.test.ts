import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { M } from "./documents";
import { as, enabled, fx, isDenied, record, ROLE_KEYS, summary, uuid } from "./helpers";
import type { GqlResult, UserKey } from "./helpers";

type Role = "ADMIN" | "PROJECT_MANAGER" | "MEMBER" | "VIEWER";
const ROLE_OF: Record<UserKey, Role> = { A_ADMIN: "ADMIN", A_PM: "PROJECT_MANAGER", A_MEMBER: "MEMBER", A_VIEWER: "VIEWER", B_PM: "PROJECT_MANAGER" };
const MANAGERS: Role[] = ["ADMIN", "PROJECT_MANAGER"];
const ALL: Role[] = ["ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"];

/** A task assigned to the MEMBER, created fresh for each role so state-changing calls don't interfere. */
const disposable: Partial<Record<UserKey, string>> = {};
const createdProjects: string[] = [];
const createdOrgs: string[] = [];

async function newTask(title: string): Promise<string> {
  const r = await as("A_ADMIN", M.addTask, { clientRequestId: uuid(), projectId: fx.projects.A.id, title, assigneeId: fx.users.A_MEMBER.memberId });
  const id = (r.data?.addTask as { id?: string } | null)?.id;
  if (!id) throw new Error(`setup: addTask failed ${summary(r)}`);
  return id;
}

interface Op {
  name: string;
  allowed: Role[];
  call: (key: UserKey) => Promise<GqlResult>;
  /** Errors that still mean "passed authorisation" (e.g. NOT_FOUND on a fake id). */
  acceptable?: RegExp;
  after?: (key: UserKey, r: GqlResult) => void;
}

const OPS: Op[] = [
  {
    name: "createProject (direct model write)",
    allowed: MANAGERS,
    call: (k) => as(k, M.createProject, { input: { organisationId: fx.orgAId, name: `sec role ${k}`, status: "DRAFT" } }),
    after: (_k, r) => { const id = (r.data?.createProject as { id?: string } | null)?.id; if (id) createdProjects.push(id); },
  },
  { name: "updateProject", allowed: MANAGERS, call: (k) => as(k, M.updateProject, { input: { id: fx.projects.A.id, name: fx.projects.A.name } }) },
  { name: "createMilestone", allowed: MANAGERS, call: (k) => as(k, M.createMilestone, { input: { projectId: fx.projects.A.id, name: `sec role ${k}` } }) },
  { name: "createDependency (direct, must go through editTask)", allowed: [], call: (k) => as(k, M.createDependency, { input: { fromTaskId: fx.tasks.A.id, toTaskId: fx.tasks.A.id, type: "FINISH_TO_START" } }) },
  {
    name: "createOrganisation",
    allowed: ["ADMIN"],
    call: (k) => as(k, M.createOrganisation, { input: { name: `sec role org ${k}` } }),
    after: (_k, r) => { const id = (r.data?.createOrganisation as { id?: string } | null)?.id; if (id) createdOrgs.push(id); },
  },
  { name: "createTask (direct model write)", allowed: [], call: (k) => as(k, M.createTask, { input: { projectId: fx.projects.A.id, title: `sec ${k}` } }) },
  { name: "addTask", allowed: MANAGERS, call: (k) => as(k, M.addTask, { clientRequestId: uuid(), projectId: fx.projects.A.id, title: `sec role addTask ${k}`, assigneeId: fx.users.A_MEMBER.memberId }) },
  { name: "editTask", allowed: MANAGERS, call: (k) => as(k, M.editTask, { clientRequestId: uuid(), taskId: disposable[k], title: `sec disposable ${k}`, assigneeId: fx.users.A_MEMBER.memberId }) },
  { name: "assignTask", allowed: MANAGERS, call: (k) => as(k, M.assignTask, { clientRequestId: uuid(), taskId: disposable[k], assigneeId: fx.users.A_MEMBER.memberId }) },
  { name: "changeTaskStatus (task assigned to the MEMBER)", allowed: ["ADMIN", "PROJECT_MANAGER", "MEMBER"], call: (k) => as(k, M.changeTaskStatus, { clientRequestId: uuid(), taskId: disposable[k], status: "IN_PROGRESS" }) },
  { name: "cancelTask", allowed: MANAGERS, call: (k) => as(k, M.cancelTask, { clientRequestId: uuid(), taskId: disposable[k] }) },
  { name: "logEvent (project entity)", allowed: MANAGERS, call: (k) => as(k, M.logEvent, { clientRequestId: uuid(), entityId: fx.projects.A.id, eventType: "UPDATED" }) },
  { name: "generateWeeklyReport", allowed: ["ADMIN"], call: (k) => as(k, M.generateWeeklyReport, { projectId: fx.projects.A.id }) },
  { name: "resolveEscalation (unknown id)", allowed: MANAGERS, acceptable: /\[NOT_FOUND\]/, call: (k) => as(k, M.resolveEscalation, { clientRequestId: uuid(), escalationId: "sec-missing-escalation", decision: "ACCEPT_DELAY" }) },
  {
    name: "manageTeamMember UPDATE (viewer record, unchanged values)",
    allowed: MANAGERS,
    call: (k) => as(k, M.manageTeamMember, { action: "UPDATE", memberId: fx.users.A_VIEWER.memberId, organisationId: fx.orgAId, name: "Security A_VIEWER", email: fx.users.A_VIEWER.email, username: "sec-a-viewer", roles: ["VIEWER"], weeklyCapacityHours: 40 }),
    // The viewer editing its own record is refused by the self-edit rule, which is also a deny.
  },
  { name: "updateMyProfile (own profile)", allowed: ALL, call: (k) => as(k, M.updateMyProfile, { name: `Security ${k}` }) },
  { name: "heartbeatPresence", allowed: ALL, call: (k) => as(k, M.heartbeatPresence, { status: "ONLINE" }) },
];

describe.skipIf(!enabled)("b. role matrix", () => {
  beforeAll(async () => {
    for (const k of ROLE_KEYS) disposable[k] = await newTask(`sec disposable ${k}`);
  }, 120_000);

  afterAll(async () => {
    for (const id of createdProjects) await as("A_ADMIN", M.deleteProject, { input: { id } });
    for (const id of createdOrgs) await as("A_ADMIN", `mutation ($input: DeleteOrganisationInput!) { deleteOrganisation(input: $input) { id } }`, { input: { id } });
  });

  for (const op of OPS) {
    for (const key of ROLE_KEYS) {
      const role = ROLE_OF[key];
      const expectAllow = op.allowed.includes(role);
      it(`${op.name} as ${role} → ${expectAllow ? "allowed" : "denied"}`, async () => {
        const r = await op.call(key);
        op.after?.(key, r);
        const denied = isDenied(r);
        const cleanOrAcceptable = r.errors.every((e) => op.acceptable?.test(e.message));
        const pass = expectAllow ? !denied && cleanOrAcceptable : denied;
        record({ category: "b. Role matrix", name: `${op.name} – ${role}`, request: `${op.name} as ${role}`, expected: expectAllow ? "allowed" : "denied (401/Unauthorized/[FORBIDDEN])", actual: summary(r), pass });
        expect(pass).toBe(true);
      });
    }
  }

  it("MEMBER cannot change the status of a task assigned to someone else", async () => {
    const other = await as("A_ADMIN", M.addTask, { clientRequestId: uuid(), projectId: fx.projects.A.id, title: "sec not the member's task", assigneeId: fx.users.A_PM.memberId });
    const taskId = (other.data?.addTask as { id: string }).id;
    const r = await as("A_MEMBER", M.changeTaskStatus, { clientRequestId: uuid(), taskId, status: "IN_PROGRESS" });
    const pass = isDenied(r);
    record({ category: "b. Role matrix", name: "changeTaskStatus on another member's task – MEMBER", request: "changeTaskStatus as MEMBER on a task assigned to the PM", expected: "denied", actual: summary(r), pass });
    expect(pass).toBe(true);
  });

  it("PROJECT_MANAGER cannot grant ADMIN", async () => {
    const r = await as("A_PM", M.manageTeamMember, { action: "UPDATE", memberId: fx.users.A_VIEWER.memberId, organisationId: fx.orgAId, name: "Security A_VIEWER", email: fx.users.A_VIEWER.email, username: "sec-a-viewer", roles: ["ADMIN"], weeklyCapacityHours: 40 });
    const pass = isDenied(r);
    record({ category: "b. Role matrix", name: "PM grants ADMIN", request: "manageTeamMember UPDATE roles=[ADMIN] as PROJECT_MANAGER", expected: "denied", actual: summary(r), pass });
    expect(pass).toBe(true);
  });
});
