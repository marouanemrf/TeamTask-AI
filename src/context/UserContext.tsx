import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentUserInfo, signOutUser } from "../services/authService";
import type { Organisation } from "../services/client";
import { getOrCreateDefaultOrganisation } from "../services/organisationService";
import { isAdmin, isManager, primaryRole, toRoles } from "../utils/roles";
import type { Role } from "../utils/roles";

import { UserContext } from "./userContextValue";
import type { LoadStatus, UserContextValue } from "./userContextValue";

/**
 * Loads the signed-in user's email and roles (from the Cognito access token), then the
 * organisation: the first one found, or "Gogo Security" created on first ADMIN login.
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>(["VIEWER"]);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [organisationStatus, setOrganisationStatus] = useState<LoadStatus>("loading");
  const loadStarted = useRef(false); // avoids a duplicate organisation create under StrictMode

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    (async () => {
      const user = await getCurrentUserInfo();
      const userRoles = toRoles(user.groups);
      setEmail(user.email);
      setRoles(userRoles);
      const org = await getOrCreateDefaultOrganisation(isAdmin(userRoles));
      setOrganisation(org);
      setOrganisationStatus(org ? "ready" : "missing");
    })().catch((err: unknown) => {
      console.error("[UserContext] Loading failed", err);
      setOrganisationStatus("missing");
    });
  }, []);

  const signOut = useCallback(() => signOutUser(), []);

  const value = useMemo<UserContextValue>(
    () => ({
      email,
      roles,
      primaryRole: primaryRole(roles),
      isAdmin: isAdmin(roles),
      isManager: isManager(roles),
      organisation,
      organisationId: organisation?.id ?? null,
      organisationStatus,
      signOut,
    }),
    [email, roles, organisation, organisationStatus, signOut],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
