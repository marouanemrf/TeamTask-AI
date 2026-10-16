import { createContext } from "react";
import type { Organisation } from "../services/client";
import type { Role } from "../utils/roles";

export type LoadStatus = "loading" | "ready" | "missing";

export interface UserContextValue {
  email: string | null;
  /** Cognito groups; a user with no group is treated as VIEWER. */
  roles: Role[];
  primaryRole: Role;
  isAdmin: boolean;
  /** ADMIN or PROJECT_MANAGER. */
  isManager: boolean;
  organisation: Organisation | null;
  organisationId: string | null;
  organisationStatus: LoadStatus;
  signOut: () => Promise<void>;
}

export const UserContext = createContext<UserContextValue | null>(null);
