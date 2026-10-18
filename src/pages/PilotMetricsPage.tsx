import { useEffect, useId, useMemo, useState } from "react";
import StatCard from "../components/ui/StatCard";
import LoadingState from "../components/ui/LoadingState";
import { useTasks } from "../hooks/useTasks";
import { useTeamMembers } from "../hooks/useTeam";
import { useUser } from "../hooks/useUser";
import { loadPilotRecords } from "../services/pilotService";
import type { PilotRecords } from "../services/pilotService";
import { describeApiError } from "../utils/apiErrors";
import { todayIsoDate } from "../utils/dates";
import { computePilotMetrics } from "../utils/pilotMetrics";

const PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 3650, label: "Since the start" },
] as const;

/** "No data" when there is nothing to measure yet ("—" is the loading placeholder of StatCard). */
const show = (value: number | null, suffix = "%") => (value === null ? "No data" : `${value}${suffix}`);

/**
 * Pilot measures from the proposal (§7 step 8): assignment quality, reminder effectiveness, overdue
 * tasks and manager time saved. Everything comes from the app's records; the time saved is an
 * estimate from the minutes the manager enters here (not stored).
 */
function PilotMetricsPage() {
  const id = useId();
  const { isManager, organisationStatus } = useUser();
  const { tasks, loading: tasksLoading } = useTasks();
  const { members } = useTeamMembers();
  const [records, setRecords] = useState<PilotRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [minutesPerTask, setMinutesPerTask] = useState(10);
  const [minutesPerReport, setMinutesPerReport] = useState(30);
  const today = todayIsoDate();

  useEffect(() => {
    if (!isManager) return;
    let active = true;
    loadPilotRecords()
      .then((r) => active && setRecords(r))
      .catch((err) => active && setError(describeApiError(err)));
    return () => {
      active = false;
    };
  }, [isManager]);

  const metrics = useMemo(() => {
    if (!records) return null;
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400_000).toISOString();
    return computePilotMetrics({ ...records, tasks, today, since, minutesPerTask, minutesPerReport });
  }, [records, tasks, today, days, minutesPerTask, minutesPerReport]);

  if (organisationStatus === "loading") return <LoadingState className="empty-state panel">Loading pilot metrics…</LoadingState>;
  if (!isManager) return <p className="empty-state panel">Pilot metrics are available to administrators and project managers.</p>;
  if (error) return <div className="form-alert" role="alert"><span>{error}</span></div>;
  if (!metrics || tasksLoading) return <LoadingState className="empty-state panel">Loading pilot metrics…</LoadingState>;

  const hours = Math.round((metrics.timeSaved.minutes / 60) * 10) / 10;
  return (
    <div className="page-stack">
      <section className="panel">
        <h2 className="panel__title">Pilot metrics</h2>
        <p className="form-hint">
          Measures for the pilot with {members.length} member{members.length === 1 ? "" : "s"}: assignment quality, reminder effectiveness, overdue tasks and manager time saved. Computed from the app's records.
        </p>
        <div className="toolbar__filter">
          <label className="form-field__label" htmlFor={`${id}-period`}>Period</label>
          <select id={`${id}-period`} className="form-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
        </div>
      </section>

      <section aria-labelledby={`${id}-assign`}>
        <h2 id={`${id}-assign`} className="panel__title panel__title--spaced">Assignment quality</h2>
        <div className="stat-grid">
          <StatCard label="AI owners kept at approval" value={show(metrics.assignment.ownersKeptAtApproval)} hint="Owners the manager didn't change before approving a plan" />
          <StatCard label="AI tasks never reassigned" value={show(metrics.assignment.aiTasksNeverReassigned)} hint={`${metrics.assignment.aiTasks} task${metrics.assignment.aiTasks === 1 ? "" : "s"} created from AI plans`} />
          <StatCard label="Plans approved" value={`${metrics.plans.approved} / ${metrics.plans.requested}`} hint={`${metrics.plans.rejected} rejected · ${metrics.plans.expiredOrFailed} expired or failed · ${metrics.plans.pending} open`} />
          <StatCard label="Median time to decision" value={show(metrics.plans.medianDecisionHours, " h")} hint="From AI proposal to manager decision" />
        </div>
      </section>

      <section aria-labelledby={`${id}-rem`}>
        <h2 id={`${id}-rem`} className="panel__title panel__title--spaced">Reminders and overdue work</h2>
        <div className="stat-grid">
          <StatCard label="Reminders sent" value={String(metrics.reminders.sent)} hint={metrics.reminders.failed ? `${metrics.reminders.failed} failed to send` : undefined} tone={metrics.reminders.failed ? "alert" : "default"} />
          <StatCard label="Followed by progress" value={show(metrics.reminders.followedByProgress)} hint="Status changed within 48 h of the reminder" />
          <StatCard label="Overdue tasks" value={String(metrics.overdue.overdue)} hint={`${show(metrics.overdue.overduePercent)} of ${metrics.overdue.open} open tasks`} tone={metrics.overdue.overdue ? "alert" : "default"} />
          <StatCard label="Overdue trend" value={metrics.overdue.trend.length ? metrics.overdue.trend.map((t) => t.overdue).join(" → ") : "No data"} hint={metrics.overdue.trend.length ? `Weekly reports ${metrics.overdue.trend[0].week} to ${metrics.overdue.trend[metrics.overdue.trend.length - 1].week}` : "No weekly reports yet"} />
        </div>
      </section>

      <section className="panel" aria-labelledby={`${id}-time`}>
        <h2 id={`${id}-time`} className="panel__title">Manager time saved (estimate)</h2>
        <p className="form-hint">An estimate, not a measurement: tasks drafted by AI and reports written by AI in the period, times the minutes you think each one saves.</p>
        <div className="modal__row">
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-mpt`}>Minutes saved per AI-drafted task</label>
            <input id={`${id}-mpt`} className="form-input form-input--narrow" type="number" min={0} max={240} value={minutesPerTask} onChange={(e) => setMinutesPerTask(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-mpr`}>Minutes saved per AI-written report</label>
            <input id={`${id}-mpr`} className="form-input form-input--narrow" type="number" min={0} max={480} value={minutesPerReport} onChange={(e) => setMinutesPerReport(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
        <p><strong>{hours} h</strong> estimated · {metrics.timeSaved.aiTasks} AI-drafted task{metrics.timeSaved.aiTasks === 1 ? "" : "s"} · {metrics.timeSaved.aiReports} AI-written report{metrics.timeSaved.aiReports === 1 ? "" : "s"}</p>
      </section>
    </div>
  );
}

export default PilotMetricsPage;
