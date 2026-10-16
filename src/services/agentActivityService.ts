import { authorizedFetch } from "./restApi";

export interface RecordedStep {
  tool: string;
  status: "OK" | "FORBIDDEN" | "INVALID" | "ERROR" | "RUNNING";
  summary: string;
  durationMs?: number;
}

/** A recorded assistant execution: status, timing and tool steps — never message text or data. */
export interface RecordedExecution {
  executionId: string;
  startedAt: string;
  durationMs: number | null;
  status: "COMPLETED" | "FAILED" | "RATE_LIMITED" | "STOPPED";
  errorCode: string | null;
  steps: RecordedStep[];
  guardrailInterventions: number;
  route: string | null;
  projectId: string | null;
  mine: boolean;
  /** Only in an ADMIN's organisation-wide view. */
  role?: string | null;
}

export interface ExecutionHistory {
  scope: "own" | "organisation";
  days: number;
  executions: RecordedExecution[];
}

export async function listAgentExecutions(days = 7): Promise<ExecutionHistory> {
  const response = await authorizedFetch(`/assistant/executions?days=${days}`);
  return (await response.json()) as ExecutionHistory;
}
