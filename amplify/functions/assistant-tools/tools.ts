/**
 * Assistant tools: pure logic over a DataSource, so the permission matrix is unit-tested without
 * AWS. Rules enforced here (never by the model):
 * - the caller (role, organisation, email) comes from the session attributes set by
 *   assistant-chat from the Cognito token — never from tool parameters;
 * - every record is checked against the caller's organisation;
 * - anything outside the caller's rights, or that doesn't exist, returns the same FORBIDDEN
 *   result, so the answer never reveals whether data exists;
 * - results carry only the fields the role needs (no capacity, emails or audit details unless allowed);
 * - prepareAction only returns a card: nothing is written.
 */
import { canBeAssigned, checkStatusChange, isOverdue, TASK_STATUSES } from "../shared/rules";
import type { TaskLike, TaskStatusValue } from "../shared/rules";
import { ACTION_TYPES, canPrepare, canUseTool } from "../shared/assistantAccess";
import type { ActionType, AssistantRole, AssistantTool } from "../shared/assistantAccess";

export interface Caller {
  userId: string;
  email: string;
  orgId: string | null;
  role: AssistantRole;
}

export interface MemberRow { id: string; organisationId: string; name: string; email: string; role?: string | null; roles?: (string | null)[] | null; weeklyCapacityHours?: number | null }
export interface ProjectRow { id: string; organisationId: string; name: string; status?: string | null; startDate?: string | null; endDate?: string | null; objective?: string | null }
export interface TaskRow {
  id: string; projectId: string; title: string; status?: string | null; priority?: string | null; dueDate?: string | null;
  estimatedHours?: number | null; assigneeId?: string | null; description?: string | null; requiredSkills?: (string | null)[] | null;
}
export interface DependencyRow { fromTaskId: string; toTaskId: string }
export interface ReportRow { id: string; projectId: string; year?: number | null; weekNumber?: number | null; summary?: string | null; risks?: (string | null)[] | null; correctiveActions?: (string | null)[] | null; totalCount?: number | null; completedCount?: number | null; overdueCount?: number | null; completionRate?: number | null }
export interface EscalationRow { id: string; taskId: string; status?: string | null; reason?: string | null; createdAt?: string | null }
export interface EventRow { id: string; entityId: string; eventType?: string | null; actorType?: string | null; actorEmail?: string | null; createdAt: string }
export interface ActivityRow { orgId: string; at: string; kind: string; tool?: string; role?: string; allowed?: boolean; outcome?: string; durationMs?: number; toolsCalled?: string[]; guardrailInterventions?: number }

/** Read access the tools need. Implementations must not filter by organisation: the tools do. */
export interface DataSource {
  members(orgId: string): Promise<MemberRow[]>;
  projects(orgId: string): Promise<ProjectRow[]>;
  project(id: string): Promise<ProjectRow | null>;
  tasks(projectIds: readonly string[]): Promise<TaskRow[]>;
  task(id: string): Promise<TaskRow | null>;
  dependencies(taskIds: readonly string[]): Promise<DependencyRow[]>;
  reports(projectId: string): Promise<ReportRow[]>;
  openEscalations(): Promise<EscalationRow[]>;
  events(sinceIso: string): Promise<EventRow[]>;
  activity(orgId: string, sinceIso: string): Promise<ActivityRow[]>;
}

export type ToolResult = { status: "OK"; data: unknown } | { status: "FORBIDDEN" } | { status: "INVALID"; message: string };
const FORBIDDEN: ToolResult = { status: "FORBIDDEN" };
const ok = (data: unknown): ToolResult => ({ status: "OK", data });
const invalid = (message: string): ToolResult => ({ status: "INVALID", message });

/** A stored task as the shared rules see it (status values are validated on write). */
const like = (t: TaskRow): TaskLike => ({ ...t, status: (t.status ?? "TODO") as TaskStatusValue });
const OPEN = (t: TaskRow) => !["DONE", "CANCELLED"].includes(t.status ?? "TODO");
const ID = /^[A-Za-z0-9:_-]{1,128}$/;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/* ------------------------------ context -------------------------------- */

class Ctx {
  private cache = new Map<string, Promise<unknown>>();
  constructor(readonly ds: DataSource, readonly caller: Caller & { orgId: string }, readonly now = today()) {}
  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key) as Promise<T>;
  }
  members = () => this.memo("members", () => this.ds.members(this.caller.orgId));
  projects = () => this.memo("projects", () => this.ds.projects(this.caller.orgId).then((ps) => ps.filter((p) => p.organisationId === this.caller.orgId)));
  /** Tasks of the organisation's projects (filtered here too: the data source is not trusted to). */
  orgTasks = () => this.memo("tasks", async () => {
    const ids = new Set((await this.projects()).map((p) => p.id));
    return (await this.ds.tasks([...ids])).filter((t) => ids.has(t.projectId));
  });
  /** Member records of the caller in this organisation (matched by the session email). */
  myMemberIds = () => this.memo("me", async () => new Set((await this.members()).filter((m) => m.organisationId === this.caller.orgId && m.email.toLowerCase() === this.caller.email).map((m) => m.id)));
  async project(id: string | undefined): Promise<ProjectRow | null> {
    if (!id || !ID.test(id)) return null;
    return (await this.projects()).find((p) => p.id === id) ?? null;
  }
  async task(id: string | undefined): Promise<TaskRow | null> {
    if (!id || !ID.test(id)) return null;
    return (await this.orgTasks()).find((t) => t.id === id) ?? null;
  }
  async memberName(id: string | null | undefined) {
    if (!id) return null;
    return (await this.members()).find((m) => m.id === id)?.name ?? null;
  }
  /** Projects in which the caller has at least one task (what a MEMBER may look into). */
  myProjectIds = () => this.memo("myProjects", async () => {
    const mine = await this.myMemberIds();
    return new Set((await this.orgTasks()).filter((t) => t.assigneeId && mine.has(t.assigneeId)).map((t) => t.projectId));
  });
  isManager = () => this.caller.role === "ADMIN" || this.caller.role === "PROJECT_MANAGER";
}

/* -------------------------------- tools -------------------------------- */

async function getMyTasks(c: Ctx, p: Params): Promise<ToolResult> {
  const filter = p.filter ?? "open";
  if (!["open", "overdue", "thisWeek", "all"].includes(filter)) return invalid("filter must be open, overdue, thisWeek or all");
  const mine = await c.myMemberIds();
  const projects = new Map((await c.projects()).map((pr) => [pr.id, pr.name]));
  const weekEnd = new Date(Date.parse(`${c.now}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const tasks = (await c.orgTasks())
    .filter((t) => t.assigneeId && mine.has(t.assigneeId))
    .filter((t) => filter === "all" || (OPEN(t) && (filter === "open" || (filter === "overdue" ? isOverdue(like(t), c.now) : !!t.dueDate && t.dueDate <= weekEnd))))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  return ok(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate ?? null, project: projects.get(t.projectId) ?? null })));
}

async function getProjectStatus(c: Ctx, p: Params): Promise<ToolResult> {
  const all = await c.projects();
  const selected = p.projectId ? [await c.project(p.projectId)] : all;
  if (selected.some((x) => !x)) return FORBIDDEN;
  const tasks = await c.orgTasks();
  return ok((selected as ProjectRow[]).map((pr) => {
    const own = tasks.filter((t) => t.projectId === pr.id && t.status !== "CANCELLED");
    const done = own.filter((t) => t.status === "DONE").length;
    const overdue = own.filter((t) => isOverdue(like(t), c.now));
    const base = {
      id: pr.id, name: pr.name, status: pr.status ?? null, startDate: pr.startDate ?? null, endDate: pr.endDate ?? null,
      progressPercent: own.length ? Math.round((done / own.length) * 100) : 0,
      taskCounts: { total: own.length, done, inProgress: own.filter((t) => t.status === "IN_PROGRESS").length, blocked: own.filter((t) => t.status === "BLOCKED").length, overdue: overdue.length },
    };
    // VIEWER: aggregates only. Others also see which tasks are late.
    return c.caller.role === "VIEWER" ? base : { ...base, overdueTasks: overdue.map((t) => ({ title: t.title, dueDate: t.dueDate })) };
  }));
}

async function getProjectTasks(c: Ctx, p: Params): Promise<ToolResult> {
  const project = await c.project(p.projectId);
  if (!project) return FORBIDDEN;
  if (!c.isManager() && !(await c.myProjectIds()).has(project.id)) return FORBIDDEN;
  const tasks = (await c.orgTasks()).filter((t) => t.projectId === project.id && t.status !== "CANCELLED");
  const rows = await Promise.all(tasks.map(async (t) => {
    const limited = { id: t.id, title: t.title, status: t.status, dueDate: t.dueDate ?? null, assignee: await c.memberName(t.assigneeId) };
    return c.isManager() ? { ...limited, priority: t.priority, estimatedHours: t.estimatedHours ?? null } : limited;
  }));
  return ok({ project: project.name, tasks: rows });
}

async function getTaskDetails(c: Ctx, p: Params): Promise<ToolResult> {
  const task = await c.task(p.taskId);
  if (!task) return FORBIDDEN;
  const mine = await c.myMemberIds();
  const own = !!task.assigneeId && mine.has(task.assigneeId);
  if (!c.isManager() && !own && !(await c.myProjectIds()).has(task.projectId)) return FORBIDDEN;
  const project = await c.project(task.projectId);
  const deps = await c.ds.dependencies([task.id]);
  const byId = new Map((await c.orgTasks()).map((t) => [t.id, t]));
  const dependsOn = deps.filter((d) => d.fromTaskId === task.id).map((d) => byId.get(d.toTaskId)).filter((t): t is TaskRow => !!t).map((t) => ({ title: t.title, status: t.status }));
  const limited = { id: task.id, title: task.title, status: task.status, dueDate: task.dueDate ?? null, assignee: await c.memberName(task.assigneeId), project: project?.name ?? null, dependsOn };
  if (!c.isManager() && !own) return ok(limited);
  return ok({ ...limited, priority: task.priority, description: task.description ?? null, requiredSkills: (task.requiredSkills ?? []).filter(Boolean), estimatedHours: task.estimatedHours ?? null });
}

async function getWeeklyReports(c: Ctx, p: Params): Promise<ToolResult> {
  const project = await c.project(p.projectId);
  if (!project) return FORBIDDEN;
  const reports = (await c.ds.reports(project.id)).filter((r) => r.projectId === project.id)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.weekNumber ?? 0) - (a.weekNumber ?? 0)).slice(0, 4);
  return ok(reports.map((r) => ({
    week: r.weekNumber, year: r.year, summary: r.summary, completionRate: r.completionRate, total: r.totalCount, done: r.completedCount, overdue: r.overdueCount,
    ...(c.caller.role === "VIEWER" ? {} : { risks: (r.risks ?? []).filter(Boolean), correctiveActions: (r.correctiveActions ?? []).filter(Boolean) }),
  })));
}

async function getTeamWorkload(c: Ctx, p: Params): Promise<ToolResult> {
  if (p.projectId && !(await c.project(p.projectId))) return FORBIDDEN;
  const tasks = (await c.orgTasks()).filter((t) => OPEN(t) && (!p.projectId || t.projectId === p.projectId));
  const members = (await c.members()).filter((m) => m.organisationId === c.caller.orgId);
  return ok(members.map((m) => {
    const hours = tasks.filter((t) => t.assigneeId === m.id).reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
    const capacity = m.weeklyCapacityHours ?? 0;
    return { name: m.name, openTasks: tasks.filter((t) => t.assigneeId === m.id).length, openHours: hours, capacityHours: capacity, loadPercent: capacity ? Math.round((hours / capacity) * 100) : null };
  }).sort((a, b) => (b.loadPercent ?? 0) - (a.loadPercent ?? 0)));
}

async function getRisksAndDelays(c: Ctx, p: Params): Promise<ToolResult> {
  if (p.projectId) {
    const project = await c.project(p.projectId);
    if (!project || (!c.isManager() && !(await c.myProjectIds()).has(project.id))) return FORBIDDEN;
  }
  const mine = await c.myMemberIds();
  const all = await c.orgTasks();
  const scope = all.filter((t) => OPEN(t) && (!p.projectId || t.projectId === p.projectId) && (c.isManager() || (!!t.assigneeId && mine.has(t.assigneeId))));
  const deps = await c.ds.dependencies(scope.map((t) => t.id));
  const byId = new Map(all.map((t) => [t.id, t]));
  const projects = new Map((await c.projects()).map((pr) => [pr.id, pr.name]));
  const risks = await Promise.all(scope.map(async (t) => {
    const late = isOverdue(like(t), c.now);
    const waitingOn = deps.filter((d) => d.fromTaskId === t.id).map((d) => byId.get(d.toTaskId)).filter((x): x is TaskRow => !!x && OPEN(x)).map((x) => x.title);
    const dueSoon = !!t.dueDate && !late && daysBetween(c.now, t.dueDate) <= 3;
    if (!late && !dueSoon && t.status !== "BLOCKED" && waitingOn.length === 0) return null;
    return {
      title: t.title, project: projects.get(t.projectId) ?? null, dueDate: t.dueDate ?? null, status: t.status,
      daysLate: late && t.dueDate ? daysBetween(t.dueDate, c.now) : 0, dueSoon, waitingOn,
      ...(c.isManager() ? { assignee: await c.memberName(t.assigneeId) } : {}),
    };
  }));
  return ok(risks.filter(Boolean));
}

async function getEscalations(c: Ctx): Promise<ToolResult> {
  const tasks = new Map((await c.orgTasks()).map((t) => [t.id, t]));
  const projects = new Map((await c.projects()).map((pr) => [pr.id, pr.name]));
  const rows = (await c.ds.openEscalations()).filter((e) => tasks.has(e.taskId));
  return ok(await Promise.all(rows.map(async (e) => {
    const t = tasks.get(e.taskId)!;
    return { task: t.title, project: projects.get(t.projectId) ?? null, assignee: await c.memberName(t.assigneeId), reason: e.reason ?? null, since: e.createdAt ?? null };
  })));
}

async function getAuditEvents(c: Ctx, p: Params): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(p.days ?? 7) || 7, 1), 30);
  if (p.entityId && !ID.test(p.entityId)) return invalid("entityId is not a valid id");
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const tasks = new Map((await c.orgTasks()).map((t) => [t.id, t.title]));
  const projects = new Map((await c.projects()).map((pr) => [pr.id, pr.name]));
  const members = new Map((await c.members()).filter((m) => m.organisationId === c.caller.orgId).map((m) => [m.id, m.name]));
  const label = (id: string) => tasks.get(id) ?? projects.get(id) ?? members.get(id);
  const events = (await c.ds.events(since))
    .filter((e) => label(e.entityId) !== undefined && (!p.entityId || e.entityId === p.entityId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  return ok(events.map((e) => ({ at: e.createdAt, event: e.eventType, entity: label(e.entityId), actor: e.actorType === "USER" ? e.actorEmail ?? null : e.actorType })));
}

async function getAgentActivity(c: Ctx, p: Params): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(p.days ?? 7) || 7, 1), 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = (await c.ds.activity(c.caller.orgId, since)).filter((a) => a.orgId === c.caller.orgId);
  const toolCalls = rows.filter((a) => a.kind === "TOOL");
  const sessions = rows.filter((a) => a.kind === "SESSION");
  const byTool = new Map<string, { calls: number; denied: number }>();
  for (const a of toolCalls) {
    const entry = byTool.get(a.tool ?? "?") ?? { calls: 0, denied: 0 };
    entry.calls += 1;
    if (!a.allowed) entry.denied += 1;
    byTool.set(a.tool ?? "?", entry);
  }
  return ok({
    days, conversations: sessions.length, guardrailInterventions: sessions.reduce((s, a) => s + (a.guardrailInterventions ?? 0), 0),
    errors: sessions.filter((a) => a.outcome === "ERROR").length,
    tools: [...byTool].map(([tool, v]) => ({ tool, ...v })),
  });
}

/* ---------------------------- action cards ----------------------------- */

export interface ActionCard {
  type: ActionType;
  targetId: string;
  title: string;
  changes: string[];
  params: Record<string, string>;
}

async function prepareAction(c: Ctx, p: Params): Promise<ToolResult> {
  const type = p.type as ActionType;
  if (!(ACTION_TYPES as readonly string[]).includes(type)) return invalid(`type must be one of ${ACTION_TYPES.join(", ")}`);
  if (!canPrepare(c.caller.role, type)) return FORBIDDEN;
  let params: Record<string, string> = {};
  try {
    const raw = p.params ? JSON.parse(p.params) : {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v).slice(0, 500)]));
  } catch {
    return invalid("params must be a JSON object");
  }

  if (type === "START_PLANNING") {
    const project = await c.project(p.targetId);
    if (!project) return FORBIDDEN;
    return ok({ card: { type, targetId: project.id, title: `Plan “${project.name}”`, changes: ["Opens the project so you can plan it. Nothing changes until you save."], params: {} } satisfies ActionCard });
  }

  const task = await c.task(p.targetId);
  if (!task || !OPEN(task)) return FORBIDDEN;
  const mine = await c.myMemberIds();
  const own = !!task.assigneeId && mine.has(task.assigneeId);

  if (type === "CHANGE_MY_TASK_STATUS" || type === "REPORT_BLOCKER") {
    if (!own) return FORBIDDEN; // "my task": only the assignee, whatever the role
    const status = type === "REPORT_BLOCKER" ? "BLOCKED" : params.status;
    if (!(TASK_STATUSES as readonly string[]).includes(status) || status === "CANCELLED") return invalid("status must be PROPOSED, TODO, IN_PROGRESS, BLOCKED or DONE");
    if (status === "BLOCKED" && (params.reason ?? "").trim().length < 10) return invalid("a blocker needs a reason of at least 10 characters");
    const tasks = await c.orgTasks();
    const check = checkStatusChange(like(task), status as TaskStatusValue, await c.ds.dependencies([task.id]), new Map(tasks.map((t) => [t.id, like(t)])));
    if (!check.ok) return invalid(check.reason);
    return ok({ card: { type, targetId: task.id, title: type === "REPORT_BLOCKER" ? `Report a blocker on “${task.title}”` : `Move “${task.title}” to ${status}`,
      changes: [`Status: ${task.status ?? "TODO"} → ${status}`, ...(status === "BLOCKED" ? [`Reason: ${params.reason.trim()}`] : [])],
      params: status === "BLOCKED" ? { status, reason: params.reason.trim() } : { status } } satisfies ActionCard });
  }

  if (type === "ASSIGN_TASK") {
    const members = (await c.members()).filter((m) => m.organisationId === c.caller.orgId);
    const assignee = members.find((m) => m.id === params.assigneeId) ?? members.find((m) => m.name.toLowerCase() === (params.assigneeName ?? "").toLowerCase());
    if (!assignee || !canBeAssigned(assignee)) return invalid("the assignee must be a member of the organisation who can hold tasks");
    return ok({ card: { type, targetId: task.id, title: `Assign “${task.title}” to ${assignee.name}`,
      changes: [`Assignee: ${(await c.memberName(task.assigneeId)) ?? "nobody"} → ${assignee.name}`], params: { assigneeId: assignee.id } } satisfies ActionCard });
  }

  // CHANGE_DUE_DATE
  const dueDate = params.dueDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate ?? "") || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) return invalid("dueDate must be YYYY-MM-DD");
  return ok({ card: { type, targetId: task.id, title: `Change the due date of “${task.title}”`, changes: [`Due date: ${task.dueDate ?? "none"} → ${dueDate}`], params: { dueDate } } satisfies ActionCard });
}

/* ------------------------------ dispatcher ----------------------------- */

export type Params = Partial<Record<"filter" | "projectId" | "taskId" | "entityId" | "days" | "type" | "targetId" | "params", string>>;

const IMPLEMENTATIONS: Record<AssistantTool, (c: Ctx, p: Params) => Promise<ToolResult>> = {
  getMyTasks, getProjectStatus, getProjectTasks, getTaskDetails, getWeeklyReports, getTeamWorkload,
  getRisksAndDelays, getEscalations, getAuditEvents, getAgentActivity, prepareAction,
};

/** Runs one tool for the caller. Role check first, then the tool's own organisation/ownership checks. */
export async function runTool(ds: DataSource, caller: Caller, tool: string, params: Params, now?: string): Promise<ToolResult> {
  if (!(tool in IMPLEMENTATIONS)) return invalid("unknown tool");
  if (!caller.orgId || !canUseTool(caller.role, tool as AssistantTool)) return FORBIDDEN;
  return IMPLEMENTATIONS[tool as AssistantTool](new Ctx(ds, { ...caller, orgId: caller.orgId }, now), params);
}
