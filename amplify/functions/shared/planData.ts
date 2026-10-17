import { createHash } from "node:crypto";
import type { Schema } from "../../data/resource";
import { check } from "./data";
import type { DataClient } from "./data";
import type { Plan, PlanContext } from "./planning";
import { isOpenTask } from "./rules";

export type RecommendationRecord = Schema["AIRecommendation"]["type"];

/** What a TASK_PLAN recommendation keeps in its payload (AWSJSON). */
export interface PlanPayload {
  scope: string;
  plan?: Plan;
  approvedPlan?: Plan;
  model?: string;
  generatedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  /** Plan key → id of the task created for it. */
  createdTaskIds?: Record<string, string>;
}

export function readPayload(record: Pick<RecommendationRecord, "payload">): PlanPayload {
  const raw = record.payload;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? (value as PlanPayload) : { scope: "" };
  } catch {
    return { scope: "" };
  }
}

async function listAll<T>(load: (nextToken: string | null | undefined) => Promise<{ data: T[]; errors?: readonly { message: string }[]; nextToken?: string | null }>, what: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await load(nextToken);
    items.push(...check(page as { data: T[]; errors?: { message: string }[] }, what));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

/**
 * Everything the planner may use, read on the server: the project, the organisation's members
 * with their current load (open estimated hours across all projects) and availability, and the
 * project's existing tasks.
 */
export async function loadPlanContext(client: DataClient, project: Schema["Project"]["type"], scope: string, today = new Date().toISOString().slice(0, 10)): Promise<PlanContext> {
  const [members, tasks] = await Promise.all([
    listAll((nextToken) => client.models.TeamMember.list({ filter: { organisationId: { eq: project.organisationId } }, nextToken, limit: 1000 }), "TeamMember.list"),
    listAll((nextToken) => client.models.Task.list({ nextToken, limit: 1000 }), "Task.list"),
  ]);
  const openHours = new Map<string, number>();
  for (const task of tasks) {
    if (task.assigneeId && isOpenTask(task)) openHours.set(task.assigneeId, (openHours.get(task.assigneeId) ?? 0) + (task.estimatedHours ?? 0));
  }
  return {
    today,
    project,
    scope,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      jobTitle: m.jobTitle,
      skills: (m.skills ?? []).filter((s): s is string => !!s),
      role: m.role,
      roles: m.roles,
      weeklyCapacityHours: m.weeklyCapacityHours ?? 40,
      openHours: openHours.get(m.id) ?? 0,
      unavailableFrom: m.unavailableFrom,
      unavailableUntil: m.unavailableUntil,
    })),
    existingTasks: tasks.filter((t) => t.projectId === project.id && t.status !== "CANCELLED").map((t) => ({ title: t.title, status: t.status })),
  };
}

/** Deterministic request id (UUID shape) for the task a plan key creates: re-running the step creates nothing twice. */
export function planTaskRequestId(recommendationId: string, key: string): string {
  const h = createHash("sha256").update(`${recommendationId}|${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
