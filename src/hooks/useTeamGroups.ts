import { useCallback, useEffect, useState } from "react";
import { createTeam, deleteTeam, observeTeams, teamsAvailable } from "../services/teamGroupService";
import type { TeamGroup } from "../services/teamGroupService";
import { describeApiError } from "../utils/apiErrors";
import { useUser } from "./useUser";

/** Live teams of the current organisation, with create / delete for managers. */
export function useTeamGroups() {
  const { organisationId } = useUser();
  const [teams, setTeams] = useState<{ org: string; items: TeamGroup[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organisationId) return;
    return observeTeams(
      organisationId,
      (items) => setTeams({ org: organisationId, items }),
      (err) => {
        console.error("[useTeamGroups] Load failed", err);
        setError(describeApiError(err));
      },
    );
  }, [organisationId]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeApiError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    /** The backend supports teams (hide the Teams panel otherwise). */
    available: teamsAvailable(),
    teams: teams && teams.org === organisationId ? teams.items : [],
    busy,
    error,
    create: (input: { name: string; description?: string; leadMemberId?: string | null }) => (organisationId ? run(() => createTeam(organisationId, input)) : Promise.resolve(false)),
    remove: (team: TeamGroup, memberCount: number) => run(() => deleteTeam(team, memberCount)),
  };
}
