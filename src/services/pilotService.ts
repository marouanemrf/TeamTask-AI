import { ApiError } from "./apiError";
import { client } from "./client";
import type { Reminder, TaskEvent, WeeklyReport } from "./client";
import { planPayload } from "./planningService";
import type { Recommendation } from "./planningService";
import type { MetricPlan } from "../utils/pilotMetrics";

/** Records behind the pilot metrics (managers: reminders and plans are readable by managers only). */
async function listAll<T>(load: (nextToken: string | null | undefined) => Promise<{ data: T[]; errors?: readonly { message: string }[]; nextToken?: string | null }>, what: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await load(nextToken);
    if (page.errors?.length) throw ApiError.from(page.errors as never, what);
    items.push(...page.data);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

export interface PilotRecords {
  events: TaskEvent[];
  reminders: Reminder[];
  plans: MetricPlan[];
  reports: WeeklyReport[];
}

function toMetricPlan(rec: Recommendation): MetricPlan {
  const payload = planPayload(rec);
  return {
    status: rec.status,
    createdAt: rec.createdAt,
    decidedAt: payload.decidedAt ?? null,
    tasks: (payload.plan?.tasks ?? []).map((t) => ({ assigneeSource: t.assigneeSource })),
    approvedTasks: payload.approvedPlan?.tasks.map((t) => ({ assigneeSource: t.assigneeSource })),
  };
}

export async function loadPilotRecords(): Promise<PilotRecords> {
  const [statusEvents, assignEvents, reminders, recommendations, reports] = await Promise.all([
    listAll((nextToken) => client.models.TaskEvent.list({ filter: { eventType: { eq: "STATUS_CHANGED" } }, nextToken, limit: 1000 }), "Event load failed"),
    listAll((nextToken) => client.models.TaskEvent.list({ filter: { eventType: { eq: "ASSIGNED" } }, nextToken, limit: 1000 }), "Event load failed"),
    listAll((nextToken) => client.models.Reminder.list({ nextToken, limit: 1000 }), "Reminder load failed"),
    listAll((nextToken) => client.models.AIRecommendation.list({ filter: { type: { eq: "TASK_PLAN" } }, nextToken, limit: 1000 }), "Plan load failed"),
    listAll((nextToken) => client.models.WeeklyReport.list({ nextToken, limit: 1000 }), "Report load failed"),
  ]);
  return { events: [...statusEvents, ...assignEvents], reminders, plans: recommendations.map(toMetricPlan), reports };
}
