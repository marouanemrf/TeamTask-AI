import type { Schema } from "../../amplify/data/resource";
import type { Plan, PlannedTask } from "../../amplify/functions/shared/planning";
import { ApiError } from "./apiError";
import { client } from "./client";

/**
 * AI planning (managers). A plan is an AIRecommendation of type TASK_PLAN, driven by the approval
 * workflow on the server: GENERATING → PENDING (waiting for a decision) → APPROVED → APPLIED, or
 * REJECTED / EXPIRED / FAILED. Nothing is created before a manager approves.
 */
export type Recommendation = Schema["AIRecommendation"]["type"];
export type Approval = Schema["Approval"]["type"];
export type RecommendationStatus = NonNullable<Recommendation["status"]>;
export type { Plan, PlannedTask };

export interface PlanPayload {
  scope: string;
  plan?: Plan;
  approvedPlan?: Plan;
  model?: string;
  generatedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdTaskIds?: Record<string, string>;
}

export function planPayload(rec: Pick<Recommendation, "payload">): PlanPayload {
  try {
    const value = typeof rec.payload === "string" ? JSON.parse(rec.payload) : rec.payload;
    return value && typeof value === "object" ? (value as PlanPayload) : { scope: "" };
  } catch {
    return { scope: "" };
  }
}

/** Live list of a project's plans, newest first. */
export function observeProjectPlans(projectId: string, onChange: (items: Recommendation[]) => void, onError: (err: unknown) => void): () => void {
  const sub = client.models.AIRecommendation.observeQuery({ filter: { projectId: { eq: projectId }, type: { eq: "TASK_PLAN" } } }).subscribe({
    next: ({ items }) => onChange([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    error: onError,
  });
  return () => sub.unsubscribe();
}

/** One plan, read again (the workflow writes outside this browser). */
export async function getPlan(id: string): Promise<Recommendation | null> {
  const { data, errors } = await client.models.AIRecommendation.get({ id });
  if (errors?.length) throw ApiError.from(errors, "Plan load failed");
  return data ?? null;
}

export async function listApprovals(recommendationIds: readonly string[]): Promise<Map<string, Approval>> {
  const result = new Map<string, Approval>();
  if (!recommendationIds.length) return result;
  let nextToken: string | null | undefined;
  const wanted = new Set(recommendationIds);
  do {
    const page = await client.models.Approval.list({ nextToken, limit: 1000 });
    if (page.errors?.length) throw ApiError.from(page.errors, "Approval load failed");
    for (const a of page.data) if (wanted.has(a.recommendationId)) result.set(a.recommendationId, a);
    nextToken = page.nextToken;
  } while (nextToken);
  return result;
}

type Result = { data?: Recommendation | null; errors?: readonly { message: string; errorType?: string }[] };
function unwrap(result: Result, fallback: string): Recommendation {
  if (result.errors?.length || !result.data) throw ApiError.from(result.errors, fallback);
  return result.data;
}

export async function requestProjectPlan(projectId: string, scope: string): Promise<Recommendation> {
  return unwrap(await client.mutations.requestProjectPlan({ clientRequestId: crypto.randomUUID(), projectId, scope }), "The plan couldn't be requested.");
}

export async function decidePlan(recommendationId: string, decision: "APPROVED" | "REJECTED", comment: string, tasks?: PlannedTask[]): Promise<Recommendation> {
  return unwrap(await client.mutations.decideRecommendation({
    clientRequestId: crypto.randomUUID(),
    recommendationId,
    decision,
    comment: comment.trim() || null,
    tasks: tasks ? JSON.stringify(tasks) : null,
  }), "The decision couldn't be saved.");
}
