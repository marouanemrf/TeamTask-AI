import { Fragment, useId, useState } from "react";
import ExecutionDetails from "../components/agent/ExecutionDetails";
import { useAgentExecutions } from "../hooks/useAgentExecutions";
import { useProjects } from "../hooks/useProjects";
import { formatDateTime } from "../utils/dates";
import { ROLE_LABELS } from "../utils/roles";
import { pageTitle } from "../utils/routes";
import type { Role } from "../utils/roles";

const STATUS: Record<string, string> = { COMPLETED: "Completed", FAILED: "Failed", RATE_LIMITED: "Rate limited", STOPPED: "Stopped" };
const seconds = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/**
 * The assistant's recorded executions: what it did (tools, outcome, timing), never what was asked
 * or answered (message text and tool data are not stored). Your own executions; an ADMIN sees the
 * whole organisation's. This is a log: use Refresh for new entries. Live details of a running
 * answer are in the assistant panel ("View agent activity").
 */
function AgentActivityPage() {
  const id = useId();
  const [days, setDays] = useState(7);
  const { history, loading, error, refresh } = useAgentExecutions(days);
  const { projects } = useProjects();
  const [open, setOpen] = useState<string | null>(null);
  const projectName = (pid: string | null) => (pid ? projects.find((p) => p.id === pid)?.name ?? "Unknown project" : null);
  const admin = history?.scope === "organisation";

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Agent activity</h2>
            <p className="form-hint">
              {admin ? "Executions of the TeamTask Assistant in your organisation." : "Your executions of the TeamTask Assistant."} Recorded log: tools
              called, outcome and timing. Questions, answers and the data the tools returned are not stored.
            </p>
          </div>
          <div className="agent-activity__filters">
            <label className="form-field__label" htmlFor={`${id}-days`}>
              Period
            </label>
            <select id={`${id}-days`} className="form-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
            <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        ) : loading && !history ? (
          <p className="empty-state">Loading activity…</p>
        ) : !history?.executions.length ? (
          <p className="empty-state">No executions in this period.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <caption className="visually-hidden">Recorded assistant executions</caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Refused</th>
                  <th scope="col">Context</th>
                  {admin && <th scope="col">Role</th>}
                  <th scope="col">
                    <span className="visually-hidden">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.executions.map((e) => {
                  const refused = e.steps.filter((s) => s.status === "FORBIDDEN").length;
                  const expanded = open === e.executionId;
                  return (
                    <Fragment key={e.executionId}>
                      <tr>
                        <td>{formatDateTime(e.startedAt)}</td>
                        <td>
                          <span className={`execution__status execution__status--${e.status.toLowerCase()}`}>{STATUS[e.status] ?? e.status}</span>
                        </td>
                        <td>{seconds(e.durationMs)}</td>
                        <td>{e.steps.length ? e.steps.map((s) => s.tool).join(", ") : "—"}</td>
                        <td>{refused || "—"}</td>
                        <td>{projectName(e.projectId) ?? (e.route ? pageTitle(e.route) : "—")}</td>
                        {admin && <td>{e.role ? ROLE_LABELS[e.role as Role] ?? e.role : "—"}{e.mine ? " (you)" : ""}</td>}
                        <td>
                          <button type="button" className="text-button" aria-expanded={expanded} aria-controls={`${id}-${e.executionId}`} onClick={() => setOpen(expanded ? null : e.executionId)}>
                            {expanded ? "Hide details" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr id={`${id}-${e.executionId}`}>
                          <td colSpan={admin ? 8 : 7}>
                            <ExecutionDetails
                              execution={{
                                agent: "TeamTask Assistant",
                                status: e.status,
                                startedAt: e.startedAt,
                                durationMs: e.durationMs,
                                steps: e.steps,
                                guardrailInterventions: e.guardrailInterventions,
                                errorCode: e.errorCode,
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default AgentActivityPage;
