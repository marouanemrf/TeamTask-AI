import { useCallback, useEffect, useState } from "react";
import type { TeamMember } from "../services/client";
import {
  createTeamMember,
  deleteTeamMember,
  findTeamMemberIdsByEmail,
  getAvatarUrl,
  observeTeamMembers,
  updateTeamMember,
} from "../services/teamService";
import type { AvatarChange, MemberInput } from "../services/teamService";
import { describeApiError } from "../utils/apiErrors";
import { useUser } from "./useUser";

/** Live members of the current organisation (TeamMember.observeQuery filtered by organisationId). */
export function useTeamMembers() {
  const { organisationId, organisationStatus } = useUser();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!organisationId) return;
    return observeTeamMembers(
      organisationId,
      (items) => {
        setMembers(items);
        setLoadedFor(organisationId);
      },
      (err) => {
        console.error("[useTeamMembers] Subscription failed", err);
        setError(true);
        setLoadedFor(organisationId);
      },
    );
  }, [organisationId]);

  // No organisation → nothing to load; otherwise wait for this organisation's first snapshot.
  const loading = organisationStatus === "loading" || (!!organisationId && loadedFor !== organisationId);
  return { members: organisationId ? members : [], loading, error };
}

/** TeamMember ids matching the signed-in user's email (tasks are assigned to TeamMembers). */
export function useMyTeamMemberIds() {
  const { email } = useUser();
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) return;
    let active = true;
    findTeamMemberIdsByEmail(email)
      .then((found) => active && setIds(found))
      .catch((err: unknown) => console.error("[useMyTeamMemberIds] Lookup failed", err))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [email]);

  return { ids, loading };
}

/** Create / update / delete members (managers only — the API enforces it too). Errors are user-facing. */
export function useMemberActions() {
  const { organisationId } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setSubmitting(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      console.error("[useMemberActions] Action failed", err);
      setError(describeApiError(err));
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const create = useCallback(
    (input: MemberInput, avatar: AvatarChange) => {
      if (!organisationId) {
        setError("No organisation is set up yet. Contact your administrator.");
        return Promise.resolve(null);
      }
      return run(() => createTeamMember(organisationId, input, avatar));
    },
    [organisationId, run],
  );

  const update = useCallback(
    (member: TeamMember, input: MemberInput, avatar: AvatarChange) =>
      run(() => updateTeamMember(member, input, avatar)),
    [run],
  );

  /** Resolves to true when deleted. */
  const remove = useCallback(
    async (member: TeamMember) => (await run(() => deleteTeamMember(member).then(() => true))) ?? false,
    [run],
  );

  const clearError = useCallback(() => setError(null), []);

  return { create, update, remove, submitting, error, clearError };
}

/* -------------------------------------------------------------------------- */
/* Profile pictures                                                            */
/* -------------------------------------------------------------------------- */

// Signed URLs are shared between components and reused until shortly before they expire.
const avatarUrlCache = new Map<string, { url: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function cachedAvatarUrl(path: string | null | undefined): string | null {
  const hit = path ? avatarUrlCache.get(path) : undefined;
  return hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now() ? hit.url : null;
}

/** Display URL for a member's picture (null while loading, when absent or on error). */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const [fetched, setFetched] = useState<{ path: string; url: string } | null>(null);
  const cached = cachedAvatarUrl(path);

  useEffect(() => {
    if (!path || cachedAvatarUrl(path)) return;
    let active = true;
    getAvatarUrl(path)
      .then(({ url, expiresAt }) => {
        avatarUrlCache.set(path, { url, expiresAt: expiresAt.getTime() });
        if (active) setFetched({ path, url });
      })
      .catch((err: unknown) => console.warn("[useAvatarUrl] Could not sign URL", err));
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) return null;
  return cached ?? (fetched?.path === path ? fetched.url : null);
}
