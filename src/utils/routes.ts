import { matchPath } from "react-router-dom";

export const ROUTES = {
  dashboard: "/",
  profile: "/profile",
  projects: "/projects",
  projectNew: "/projects/new",
  projectDetail: "/projects/:id",
  myTasks: "/my-tasks",
  team: "/team",
  workload: "/team/workload",
  escalations: "/escalations",
  agentActivity: "/assistant/activity",
  pilot: "/pilot",
  audit: "/audit",
  projectReports: "/projects/:id/reports",
  memberDetail: "/team/:id",
} as const;

export function projectPath(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}

export function projectReportsPath(id: string): string {
  return `${projectPath(id)}/reports`;
}

export function memberPath(id: string): string {
  return `/team/${encodeURIComponent(id)}`;
}

// Most specific first: "/projects/new" must win over "/projects/:id".
const TITLES: ReadonlyArray<[string, string]> = [
  [ROUTES.dashboard, "Dashboard"],
  [ROUTES.profile, "My profile"],
  [ROUTES.projectNew, "New project"],
  [ROUTES.projectDetail, "Project details"],
  [ROUTES.projectReports, "Weekly reports"],
  [ROUTES.escalations, "Open escalations"],
  [ROUTES.agentActivity, "Agent activity"],
  [ROUTES.pilot, "Pilot metrics"],
  [ROUTES.audit, "Audit trail"],
  [ROUTES.projects, "Projects"],
  [ROUTES.myTasks, "My tasks"],
  [ROUTES.workload, "Team workload"],
  [ROUTES.memberDetail, "Team member"],
  [ROUTES.team, "Team"],
];

/** Page title shown in the top bar for a pathname. */
export function pageTitle(pathname: string): string {
  return TITLES.find(([pattern]) => matchPath(pattern, pathname))?.[1] ?? "TeamTask AI";
}
