/**
 * Pilot metrics (proposal §7 step 8): assignment quality, reminder effectiveness, overdue work and
 * an estimate of manager time saved — computed from the app's own records only. The time saved is
 * an estimate from the manager's own assumptions (minutes per task / per report), labelled as such.
 */

export interface MetricTask { id: string; status?: string | null; dueDate?: string | null; createdBy?: string | null; createdAt: string }
export interface MetricEvent { entityId: string; eventType?: string | null; createdAt: string }
export interface MetricReminder { taskId: string; status?: string | null; sentAt?: string | null }
export interface MetricPlan { status?: string | null; createdAt: string; tasks: { assigneeSource: string }[]; decidedAt?: string | null; approvedTasks?: { assigneeSource: string }[] }
export interface MetricReport { year?: number | null; weekNumber: number; overdueCount?: number | null; aiGenerated?: boolean | null }

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : null);
const HOURS_48 = 48 * 3600_000;

export interface PilotMetrics {
  plans: { requested: number; approved: number; rejected: number; expiredOrFailed: number; pending: number; medianDecisionHours: number | null };
  assignment: {
    /** Owners kept as the AI (or rules) proposed them when the plan was approved. */
    ownersKeptAtApproval: number | null;
    /** AI-created tasks never reassigned afterwards. */
    aiTasksNeverReassigned: number | null;
    aiTasks: number;
  };
  reminders: { sent: number; failed: number; followedByProgress: number | null };
  overdue: { open: number; overdue: number; overduePercent: number | null; trend: { week: string; overdue: number }[] };
  timeSaved: { aiTasks: number; aiReports: number; minutes: number };
}

export function computePilotMetrics(input: {
  tasks: MetricTask[];
  events: MetricEvent[];
  reminders: MetricReminder[];
  plans: MetricPlan[];
  reports: MetricReport[];
  today: string;
  since: string;
  minutesPerTask: number;
  minutesPerReport: number;
}): PilotMetrics {
  const { tasks, events, reminders, plans, reports, today, since } = input;

  // Plans
  const inPeriod = plans.filter((p) => p.createdAt >= since);
  const approved = inPeriod.filter((p) => p.status === "APPROVED" || p.status === "APPLIED");
  const decisionHours = inPeriod.filter((p) => p.decidedAt).map((p) => (Date.parse(p.decidedAt!) - Date.parse(p.createdAt)) / 3600_000).sort((a, b) => a - b);
  const median = decisionHours.length ? Math.round(decisionHours[Math.floor(decisionHours.length / 2)] * 10) / 10 : null;

  // Assignment quality
  const approvedTasks = approved.flatMap((p) => p.approvedTasks ?? []);
  const kept = approvedTasks.filter((t) => t.assigneeSource !== "MANAGER").length;
  const aiTasks = tasks.filter((t) => t.createdBy === "AI" && t.createdAt >= since);
  const reassigned = new Set(events.filter((e) => e.eventType === "ASSIGNED").map((e) => e.entityId));
  const neverReassigned = aiTasks.filter((t) => !reassigned.has(t.id)).length;

  // Reminders: progress (a status change) on the task within 48 hours of the reminder.
  const sent = reminders.filter((r) => r.status === "SENT" && r.sentAt && r.sentAt >= since);
  const changes = new Map<string, number[]>();
  for (const e of events) if (e.eventType === "STATUS_CHANGED") changes.set(e.entityId, [...(changes.get(e.entityId) ?? []), Date.parse(e.createdAt)]);
  const followed = sent.filter((r) => (changes.get(r.taskId) ?? []).some((t) => t >= Date.parse(r.sentAt!) && t - Date.parse(r.sentAt!) <= HOURS_48)).length;

  // Overdue
  const open = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const byWeek = new Map<string, number>();
  for (const r of reports) {
    const week = `${r.year ?? ""}-W${String(r.weekNumber).padStart(2, "0")}`;
    byWeek.set(week, (byWeek.get(week) ?? 0) + (r.overdueCount ?? 0));
  }
  const trend = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([week, n]) => ({ week, overdue: n }));

  const aiReports = reports.filter((r) => r.aiGenerated).length;
  return {
    plans: {
      requested: inPeriod.length,
      approved: approved.length,
      rejected: inPeriod.filter((p) => p.status === "REJECTED").length,
      expiredOrFailed: inPeriod.filter((p) => p.status === "EXPIRED" || p.status === "FAILED").length,
      pending: inPeriod.filter((p) => p.status === "PENDING" || p.status === "GENERATING").length,
      medianDecisionHours: median,
    },
    assignment: { ownersKeptAtApproval: pct(kept, approvedTasks.length), aiTasksNeverReassigned: pct(neverReassigned, aiTasks.length), aiTasks: aiTasks.length },
    reminders: { sent: sent.length, failed: reminders.filter((r) => r.status === "FAILED").length, followedByProgress: pct(followed, sent.length) },
    overdue: { open: open.length, overdue, overduePercent: pct(overdue, open.length), trend },
    timeSaved: { aiTasks: aiTasks.length, aiReports, minutes: aiTasks.length * input.minutesPerTask + aiReports * input.minutesPerReport },
  };
}
