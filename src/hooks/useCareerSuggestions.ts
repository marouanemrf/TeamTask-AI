import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCareerSuggestions } from "../services/careerService";
import type { CareerSuggestionsResult } from "../services/careerService";
import type { TeamMember } from "../services/client";
import { API_UNAVAILABLE } from "../services/restApi";
import { ApiError } from "../services/apiError";
import { describeApiError } from "../utils/apiErrors";

export type CareerState =
  | { kind: "loading" }
  | { kind: "ready"; result: CareerSuggestionsResult }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const cacheKey = (member: Pick<TeamMember, "id" | "updatedAt">) => `teamtask-career:${member.id}:${member.updatedAt}`;

function readCache(key: string): CareerSuggestionsResult | null {
  try {
    const cached = sessionStorage.getItem(key);
    return cached ? (JSON.parse(cached) as CareerSuggestionsResult) : null;
  } catch {
    return null;
  }
}

/**
 * AI career suggestions for a member's profile (the user's own, or another member's for managers).
 * Fetched again whenever the saved profile changes (its updatedAt), and kept for the browser
 * session so a page reload doesn't call the model again for the same profile. "Generate again"
 * bypasses that cache.
 */
export function useCareerSuggestions(member: Pick<TeamMember, "id" | "updatedAt"> | undefined) {
  const key = member ? cacheKey(member) : null;
  const memberId = member?.id ?? null;
  const [version, setVersion] = useState(0);
  const [fetched, setFetched] = useState<{ key: string; version: number; state: CareerState } | null>(null);
  const cached = useMemo(() => (key && version === 0 ? readCache(key) : null), [key, version]);

  useEffect(() => {
    if (!key || !memberId || cached) return;
    let cancelled = false;
    const controller = new AbortController();
    fetchCareerSuggestions(memberId, controller.signal)
      .then((result) => {
        if (cancelled) return;
        setFetched({ key, version, state: { kind: "ready", result } });
        try {
          sessionStorage.setItem(key, JSON.stringify(result));
        } catch {
          /* not cached */
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const state: CareerState = err instanceof ApiError && err.errorType === API_UNAVAILABLE ? { kind: "unavailable" } : { kind: "error", message: describeApiError(err) };
        setFetched({ key, version, state });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, memberId, version, cached]);

  const state: CareerState = cached
    ? { kind: "ready", result: cached }
    : fetched && fetched.key === key && fetched.version === version
      ? fetched.state
      : { kind: "loading" };

  /** New suggestions for the same profile (bypasses the session cache). */
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { state, refresh };
}
