import { useCallback, useEffect, useState } from "react";
import { listAgentExecutions } from "../services/agentActivityService";
import type { ExecutionHistory } from "../services/agentActivityService";
import { describeApiError } from "../utils/apiErrors";

/** Recorded assistant executions for the last `days` days (a log: refreshed on demand, not live). */
export function useAgentExecutions(days: number) {
  const [history, setHistory] = useState<ExecutionHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listAgentExecutions(days)
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        setError(null);
      })
      .catch((err) => !cancelled && setError(describeApiError(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days, version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setVersion((v) => v + 1);
  }, []);

  return { history, loading, error, refresh };
}
