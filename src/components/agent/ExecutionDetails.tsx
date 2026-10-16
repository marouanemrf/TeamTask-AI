import { AGENT_DESCRIPTION, STEP_LABELS } from "../../../amplify/functions/shared/assistantAccess";
import { formatDateTime } from "../../utils/dates";

export interface ExecutionView {
  agent: string;
  /** The question, when known (live view only: questions are never stored on the server). */
  objective?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED" | "RATE_LIMITED";
  startedAt: string;
  durationMs?: number | null;
  steps: { tool: string; label?: string; status: string; summary: string; durationMs?: number }[];
  guardrailInterventions: number;
  errorCode?: string | null;
}

const STATUS_LABEL: Record<ExecutionView["status"], string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  STOPPED: "Stopped",
  RATE_LIMITED: "Rate limited",
};
const STEP_STATUS: Record<string, string> = {
  RUNNING: "Running",
  OK: "Done",
  FORBIDDEN: "Refused (your role)",
  INVALID: "Rejected",
  ERROR: "Error",
};
const ERROR_LABEL: Record<string, string> = {
  BUSY: "The AI service was busy (throttled).",
  AGENT_ERROR: "The agent failed to answer.",
};

const seconds = (ms?: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * What the agent did for one execution: its observable steps (tools called, outcome, duration),
 * status, timing, safety-filter interventions and errors. Built from the events and records the
 * server produces — nothing is inferred, and the model's internal reasoning is not shown.
 */
function ExecutionDetails({ execution, live = false }: { execution: ExecutionView; live?: boolean }) {
  return (
    <div className="execution">
      <dl className="execution__facts">
        <div>
          <dt>Agent</dt>
          <dd>
            {execution.agent}
            <span className="execution__role">{AGENT_DESCRIPTION}</span>
          </dd>
        </div>
        {execution.objective && (
          <div>
            <dt>Task</dt>
            <dd>{execution.objective}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`execution__status execution__status--${execution.status.toLowerCase()}`}>{STATUS_LABEL[execution.status]}</span>
            {live && execution.status === "RUNNING" && <span className="execution__live"> · live</span>}
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(execution.startedAt)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{execution.status === "RUNNING" ? "In progress" : seconds(execution.durationMs)}</dd>
        </div>
        {execution.guardrailInterventions > 0 && (
          <div>
            <dt>Safety filter</dt>
            <dd>Intervened {execution.guardrailInterventions} time{execution.guardrailInterventions === 1 ? "" : "s"}</dd>
          </div>
        )}
        {execution.errorCode && (
          <div>
            <dt>Error</dt>
            <dd>{ERROR_LABEL[execution.errorCode] ?? execution.errorCode}</dd>
          </div>
        )}
      </dl>
      <h4 className="execution__heading">Steps</h4>
      {execution.steps.length === 0 ? (
        <p className="form-hint">{execution.status === "RUNNING" ? "No tool called yet." : "Answered without calling a tool."}</p>
      ) : (
        <ol className="execution__steps">
          {execution.steps.map((step, i) => (
            <li key={`${step.tool}-${i}`} className={`execution__step execution__step--${step.status.toLowerCase()}`}>
              <span className="execution__step-title">{step.label ?? STEP_LABELS[step.tool] ?? step.tool}</span>
              <span className="execution__step-meta">
                <code>{step.tool}</code> · {STEP_STATUS[step.status] ?? step.status}
                {step.durationMs != null && ` · ${seconds(step.durationMs)}`}
              </span>
              <span className="execution__step-summary">{step.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default ExecutionDetails;
