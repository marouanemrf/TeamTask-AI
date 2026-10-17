import { useCallback, useEffect, useState } from "react";
import { decidePlan, listApprovals, observeProjectPlans, requestProjectPlan } from "../services/planningService";
import type { Approval, PlannedTask, Recommendation } from "../services/planningService";
import { describeApiError } from "../utils/apiErrors";

/** A project's AI plans (live), their decisions, and the request / decide actions. */
export function usePlanning(projectId: string | undefined) {
  const [plans, setPlans] = useState<{ projectId: string; items: Recommendation[] } | null>(null);
  const [approvals, setApprovals] = useState<Map<string, Approval>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    return observeProjectPlans(
      projectId,
      (items) => setPlans({ projectId, items }),
      (err) => {
        console.error("[usePlanning] Load failed", err);
        setError(describeApiError(err));
      },
    );
  }, [projectId]);

  const items = plans && plans.projectId === projectId ? plans.items : null;
  const decidedKey = (items ?? []).filter((p) => p.status !== "GENERATING" && p.status !== "PENDING").map((p) => p.id).join(",");

  useEffect(() => {
    if (!decidedKey) return;
    let active = true;
    listApprovals(decidedKey.split(","))
      .then((map) => active && setApprovals(map))
      .catch((err) => console.error("[usePlanning] Approvals load failed", err));
    return () => {
      active = false;
    };
  }, [decidedKey]);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(describeApiError(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const request = useCallback((scope: string) => (projectId ? run(() => requestProjectPlan(projectId, scope)) : Promise.resolve(null)), [projectId, run]);
  const approve = useCallback((id: string, tasks: PlannedTask[], comment: string) => run(() => decidePlan(id, "APPROVED", comment, tasks)), [run]);
  const reject = useCallback((id: string, comment: string) => run(() => decidePlan(id, "REJECTED", comment)), [run]);

  return { plans: items ?? [], loading: !!projectId && !items, approvals, busy, error, clearError: () => setError(null), request, approve, reject };
}
