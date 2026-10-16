/**
 * What the TeamTask assistant may do for each role. Single source of truth, shared by the
 * assistant-tools function (which enforces it on every tool call) and the React app (which shows
 * the user's row in "See my access"). The model never decides permissions: it only sees what
 * the tools return.
 */
export const ASSISTANT_ROLES = ["ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

export const ASSISTANT_TOOLS = [
  "getMyTasks",
  "getProjectStatus",
  "getProjectTasks",
  "getTaskDetails",
  "getWeeklyReports",
  "getTeamWorkload",
  "getRisksAndDelays",
  "getEscalations",
  "getAuditEvents",
  "getAgentActivity",
  "prepareAction",
] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

const ALL: readonly AssistantRole[] = ASSISTANT_ROLES;
const WORKERS: readonly AssistantRole[] = ["ADMIN", "PROJECT_MANAGER", "MEMBER"];
const MANAGERS: readonly AssistantRole[] = ["ADMIN", "PROJECT_MANAGER"];

/** Roles allowed to call each tool. Finer rules (own tasks, own projects, aggregates) are in the tools. */
export const TOOL_ROLES: Record<AssistantTool, readonly AssistantRole[]> = {
  getMyTasks: WORKERS,
  getProjectStatus: ALL,
  getProjectTasks: WORKERS,
  getTaskDetails: WORKERS,
  getWeeklyReports: ALL,
  getTeamWorkload: MANAGERS,
  getRisksAndDelays: WORKERS,
  getEscalations: MANAGERS,
  getAuditEvents: ["ADMIN"],
  getAgentActivity: ["ADMIN"],
  prepareAction: WORKERS,
};

export const ACTION_TYPES = ["CHANGE_MY_TASK_STATUS", "REPORT_BLOCKER", "ASSIGN_TASK", "CHANGE_DUE_DATE", "START_PLANNING"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Action cards each role may receive (the user still confirms, and the normal API rules apply again). */
export const ACTIONS_BY_ROLE: Record<AssistantRole, readonly ActionType[]> = {
  VIEWER: [],
  MEMBER: ["CHANGE_MY_TASK_STATUS", "REPORT_BLOCKER"],
  PROJECT_MANAGER: ["CHANGE_MY_TASK_STATUS", "REPORT_BLOCKER", "ASSIGN_TASK", "CHANGE_DUE_DATE", "START_PLANNING"],
  ADMIN: ["CHANGE_MY_TASK_STATUS", "REPORT_BLOCKER", "ASSIGN_TASK", "CHANGE_DUE_DATE", "START_PLANNING"],
};

export const canUseTool = (role: AssistantRole, tool: AssistantTool) => TOOL_ROLES[tool].includes(role);
export const canPrepare = (role: AssistantRole, type: ActionType) => ACTIONS_BY_ROLE[role].includes(type);

/** One line per role, shown in the assistant header. */
export const ROLE_ACCESS_SUMMARY: Record<AssistantRole, string> = {
  VIEWER: "Project status and weekly reports (summaries only).",
  MEMBER: "Your tasks, the tasks of your projects and your risks. You can prepare status changes and blocker reports for your own tasks.",
  PROJECT_MANAGER: "All projects, tasks, team workload, risks and escalations. You can prepare assignments, due date changes and planning.",
  ADMIN: "Everything a project manager sees, plus the audit trail and the assistant's activity.",
};

/** Human labels for "See my access". */
export const TOOL_LABELS: Record<AssistantTool, string> = {
  getMyTasks: "My tasks",
  getProjectStatus: "Project status",
  getProjectTasks: "Project tasks",
  getTaskDetails: "Task details",
  getWeeklyReports: "Weekly reports",
  getTeamWorkload: "Team workload",
  getRisksAndDelays: "Risks and delays",
  getEscalations: "Escalations",
  getAuditEvents: "Audit trail",
  getAgentActivity: "Assistant activity",
  prepareAction: "Prepare actions (you confirm)",
};

/** Highest-privilege role from Cognito groups; no known group = VIEWER. */
export function primaryAssistantRole(groups: readonly string[]): AssistantRole {
  return ASSISTANT_ROLES.find((role) => groups.includes(role)) ?? "VIEWER";
}

/** What each tool step is shown as in the agent's activity (server stream and UI history). */
export const STEP_LABELS: Record<string, string> = {
  getMyTasks: "Reading your tasks",
  getProjectStatus: "Reading the project status",
  getProjectTasks: "Reading the project's tasks",
  getTaskDetails: "Reading the task",
  getWeeklyReports: "Reading the weekly reports",
  getTeamWorkload: "Computing the team's workload",
  getRisksAndDelays: "Looking for risks and delays",
  getEscalations: "Reading the escalations",
  getAuditEvents: "Reading the audit trail",
  getAgentActivity: "Reading the assistant's activity",
  prepareAction: "Preparing an action for you to confirm",
};

/** Who the assistant is, as shown in "View agent activity". */
export const AGENT_DESCRIPTION =
  "Amazon Bedrock agent that answers questions about your projects with read-only tools limited to your role, and prepares changes you confirm yourself.";
