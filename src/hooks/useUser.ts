import { useContext } from "react";
import { UserContext } from "../context/userContextValue";
import type { UserContextValue } from "../context/userContextValue";

/** Current user, roles and organisation. Must be used inside <UserProvider>. */
export function useUser(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) throw new Error("useUser must be used inside <UserProvider>.");
  return value;
}
