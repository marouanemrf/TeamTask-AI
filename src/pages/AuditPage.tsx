import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import LoadingState from "../components/ui/LoadingState";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useTeamMembers } from "../hooks/useTeam";
import { useUser } from "../hooks/useUser";
import { listAuditEvents } from "../services/auditService";
import type { TaskEvent, TaskEventType } from "../services/client";
import { describeApiError } from "../utils/apiErrors";
import { formatDateTime } from "../utils/dates";
import { TASK_EVENT_LABELS } from "../utils/projectLabels";

const ACTOR_LABELS: Record<string, string> = { USER: "User", AI: "AI", SYSTEM: "System" };

/** Short readable form of an event's before/after JSON (AWSJSON arrives as a string or an object). */
function changes(value: unknown): string {
  if (value === null || value === undefined) return "";
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!data || typeof data !== "object") return String(data);
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

/**
 * Audit trail of the organisation (use case "Manage accounts, teams, audit": administrators).
 * Every business event, append-only and copied to the immutable archive; this page only reads it.
 */
function AuditPage() {
  const id = useId();
  const { isAdmin, organisationStatus } = useUser();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { members } = useTeamMembers();
  const [days, setDays] = useState(7);
  const [type, setType] = useState<TaskEventType | "ALL">("ALL");
  const [actor, setActor] = useState("");
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await listAuditEvents(new Date(Date.now() - days * 86_400_000).toISOString()));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, `Project · ${p.name}`);
    for (const t of tasks) map.set(t.id, `Task · ${t.title}`);
    for (const m of members) map.set(m.id, `Member · ${m.name}`);
    return map;
  }, [projects, tasks, members]);

  const shown = useMemo(() => {
    const wanted = actor.trim().toLowerCase();
    return (events ?? []).filter((e) => (type === "ALL" || e.eventType === type) && (!wanted || (e.actorEmail ?? "").toLowerCase().includes(wanted)));
  }, [events, type, actor]);

  if (organisationStatus === "loading") return <LoadingState className="empty-state panel" />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Audit trail</h2>
            <p className="form-hint">Every business event of your organisation: who did what, when, and the values before and after. Events can't be changed or deleted; a copy is kept in a locked archive.</p>
          </div>
          <div className="agent-activity__filters">
            <label className="form-field__label" htmlFor={`${id}-days`}>Period</label>
            <select id={`${id}-days`} className="form-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <label className="form-field__label" htmlFor={`${id}-type`}>Event</label>
            <select id={`${id}-type`} className="form-input" value={type} onChange={(e) => setType(e.target.value as TaskEventType | "ALL")}>
              <option value="ALL">All events</option>
              {Object.entries(TASK_EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="form-field__label" htmlFor={`${id}-actor`}>Actor</label>
            <input id={`${id}-actor`} className="form-input" type="search" placeholder="Email" value={actor} onChange={(e) => setActor(e.target.value)} />
            <button type="button" className="button-secondary" onClick={() => void load()} disabled={loading}>
              {loading && <span className="spinner loading-state__spinner" aria-hidden="true" />}
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="form-alert" role="alert"><span>{error}</span></div>
        ) : events === null ? (
          <LoadingState>Loading the audit trail…</LoadingState>
        ) : shown.length === 0 ? (
          <p className="empty-state">No events in this period.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <caption className="visually-hidden">Audit events, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col">Record</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.createdAt)}</td>
                    <td>{e.eventType ? TASK_EVENT_LABELS[e.eventType] : "—"}</td>
                    <td>{names.get(e.entityId) ?? e.entityId}</td>
                    <td>{e.actorEmail ?? ACTOR_LABELS[e.actorType ?? "SYSTEM"]}{e.actorType && e.actorType !== "USER" ? ` (${ACTOR_LABELS[e.actorType]})` : ""}</td>
                    <td>{changes(e.before) || "—"}</td>
                    <td>{changes(e.after) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default AuditPage;
