/** Cognito groups, mirrored from amplify/auth/resource.ts (highest privilege first). */
export const ROLES = ["ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** "Managers" = ADMIN + PROJECT_MANAGER (full access in the data model). */
export const MANAGER_ROLES: readonly Role[] = ["ADMIN", "PROJECT_MANAGER"];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

/** Known roles from Cognito groups. A user with no group is treated as VIEWER. */
export function toRoles(groups: readonly string[]): Role[] {
  const roles = groups.filter((g): g is Role => (ROLES as readonly string[]).includes(g));
  return roles.length > 0 ? roles : ["VIEWER"];
}

export function isAdmin(roles: readonly Role[]): boolean {
  return roles.includes("ADMIN");
}

export function isManager(roles: readonly Role[]): boolean {
  return roles.some((role) => MANAGER_ROLES.includes(role));
}

/** Use case "Use the AI assistant" starts at Member: viewers only read (the server refuses them too). */
export function canUseAssistant(roles: readonly Role[]): boolean {
  return roles.some((role) => role !== "VIEWER");
}

/** The most privileged role, shown in the top bar badge. */
export function primaryRole(roles: readonly Role[]): Role {
  return ROLES.find((role) => roles.includes(role)) ?? "VIEWER";
}
