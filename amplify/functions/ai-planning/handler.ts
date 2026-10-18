import { env } from "$amplify/env/ai-planning";
import { SendTaskSuccessCommand, SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import type { Schema } from "../../data/resource";
import { writeEvent } from "../shared/audit";
import { check, createDataClient, getProject } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { loadPlanContext, readPayload } from "../shared/planData";
import { normalisePlan, SCOPE_MAX, SCOPE_MIN } from "../shared/planning";
import { isManagerRole } from "../shared/rules";
import { assertSameOrganisation, forManagers, requireOrganisation } from "../shared/tenancy";
import * as v from "../shared/validate";

const client = await createDataClient(env);
const sfn = new SFNClient({});
/** Plans a project may request per hour (each one is a model call). */
const PLANS_PER_HOUR = 5;

type RequestArgs = { clientRequestId: string; projectId: string; scope: string };
type DecideArgs = { clientRequestId: string; recommendationId: string; decision: string; comment?: string | null; tasks?: unknown };

async function recommendation(id: string, organisationId: string) {
  const record = check(await client.models.AIRecommendation.get({ id }), "AIRecommendation.get");
  if (!record) fail("NOT_FOUND", "This plan no longer exists.");
  assertSameOrganisation(record, organisationId, "This plan");
  return record;
}

/** A manager asks the AI for a plan: the record is created and the approval workflow started. */
async function requestPlan(caller: { email: string; organisationId: string }, args: RequestArgs) {
  const requestId = v.requestId(args.clientRequestId);
  const existing = check(await client.models.AIRecommendation.get({ id: requestId }), "AIRecommendation.get");
  if (existing) return recommendation(existing.id, caller.organisationId);

  const project = await getProject(client, v.id(args.projectId, "Project"), caller.organisationId);
  if (project.status === "CLOSED") fail("VALIDATION", "This project is closed.");
  const scope = v.text(args.scope, "Scope", { min: SCOPE_MIN, max: SCOPE_MAX });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = check(await client.models.AIRecommendation.list({ filter: { projectId: { eq: project.id }, createdAt: { gt: since } }, limit: 1000 }), "AIRecommendation.list");
  if (recent.length >= PLANS_PER_HOUR) fail("VALIDATION", `At most ${PLANS_PER_HOUR} plans per project per hour. Try again later.`);

  const created = check(await client.models.AIRecommendation.create({
    id: requestId,
    ...forManagers(project.organisationId),
    projectId: project.id,
    type: "TASK_PLAN",
    status: "GENERATING",
    requestedBy: caller.email,
    payload: JSON.stringify({ scope }),
  }), "AIRecommendation.create");
  if (!created) throw new Error("AIRecommendation.create returned no data");
  try {
    await sfn.send(new StartExecutionCommand({ stateMachineArn: process.env.PLAN_STATE_MACHINE_ARN!, name: requestId, input: JSON.stringify({ recommendationId: requestId }) }));
  } catch (error) {
    if (!(error instanceof Error && error.name === "ExecutionAlreadyExists")) {
      await client.models.AIRecommendation.update({ id: requestId, status: "FAILED", error: "The planning workflow couldn't start." });
      throw error;
    }
  }
  return created;
}

/**
 * The manager's decision. APPROVED: the edited plan is checked again (owners, dates, links) and
 * handed to the workflow, which creates the tasks; REJECTED: nothing is created. Either way the
 * decision is recorded (Approval + audit event).
 */
async function decide(caller: { email: string; organisationId: string }, args: DecideArgs) {
  const requestId = v.requestId(args.clientRequestId);
  const recId = v.id(args.recommendationId, "Plan");
  const already = check(await client.models.Approval.get({ id: requestId }), "Approval.get");
  if (already) return recommendation(recId, caller.organisationId);

  const decision = args.decision;
  if (decision !== "APPROVED" && decision !== "REJECTED") fail("VALIDATION", "The decision must be APPROVED or REJECTED.");
  const comment = v.optionalText(args.comment, "Comment", 1000);
  const rec = await recommendation(recId, caller.organisationId);
  if (rec.type !== "TASK_PLAN") fail("VALIDATION", "Only task plans can be decided here.");
  if (rec.status !== "PENDING" || !rec.workflowToken) fail("VALIDATION", rec.status === "GENERATING" ? "The plan is still being prepared." : "This plan has already been handled.");
  const project = await getProject(client, rec.projectId, caller.organisationId);
  const payload = readPayload(rec);
  if (!payload.plan) fail("VALIDATION", "This plan has no tasks.");

  let approvedPlan = undefined;
  if (decision === "APPROVED") {
    const raw = typeof args.tasks === "string" ? JSON.parse(args.tasks) : args.tasks;
    if (!Array.isArray(raw) || !raw.length) fail("VALIDATION", "Keep at least one task to approve the plan.");
    const original = new Map(payload.plan.tasks.map((t) => [t.key, t]));
    if (raw.some((t) => !original.has(String((t as { key?: unknown })?.key)))) fail("VALIDATION", "The plan can only keep or edit the proposed tasks.");
    const ctx = await loadPlanContext(client, project, payload.scope);
    const { plan, errors } = normalisePlan({ summary: payload.plan.summary, tasks: raw }, ctx, "MANAGER");
    if (!plan || errors.length) fail("VALIDATION", errors.join(" ") || "The plan is not valid.");
    // Owners the manager didn't change keep their origin (AI or rules).
    for (const task of plan.tasks) {
      const before = original.get(task.key);
      if (before && before.assigneeId === task.assigneeId) Object.assign(task, { assigneeSource: before.assigneeSource, assigneeReason: before.assigneeReason });
    }
    approvedPlan = plan;
  }

  const decidedAt = new Date().toISOString();
  check(await client.models.AIRecommendation.update({
    id: rec.id,
    status: decision,
    workflowToken: null,
    payload: JSON.stringify({ ...payload, ...(approvedPlan ? { approvedPlan } : {}), decidedBy: caller.email, decidedAt }),
  }), "AIRecommendation.update");
  try {
    await sfn.send(new SendTaskSuccessCommand({ taskToken: rec.workflowToken, output: JSON.stringify({ decision }) }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TaskTimedOut" || name === "InvalidToken" || name === "TaskDoesNotExist") {
      await client.models.AIRecommendation.update({ id: rec.id, status: "EXPIRED", error: "No decision was taken in time." });
      fail("VALIDATION", "This plan expired. Generate a new one.");
    }
    await client.models.AIRecommendation.update({ id: rec.id, status: "PENDING", workflowToken: rec.workflowToken, payload: JSON.stringify(payload) });
    throw error;
  }
  check(await client.models.Approval.create({ id: requestId, ...forManagers(project.organisationId), recommendationId: rec.id, approverEmail: caller.email, decision, comment, decidedAt }), "Approval.create");
  await writeEvent(client, {
    organisationId: project.organisationId,
    entityId: project.id,
    eventType: decision,
    actorEmail: caller.email,
    before: { recommendationId: rec.id, proposedTasks: payload.plan.tasks.length },
    after: { recommendationId: rec.id, decision, approvedTasks: approvedPlan?.tasks.length ?? 0, comment },
    requestId,
  });
  return recommendation(rec.id, caller.organisationId);
}

export const handler = (event: { arguments: RequestArgs | DecideArgs; identity?: unknown }) =>
  runMutation("ai-planning", event, async (caller, args) => {
    if (!isManagerRole(caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can plan projects.");
    const scoped = { email: caller.email, organisationId: requireOrganisation(caller) };
    return "decision" in args ? decide(scoped, args) : requestPlan(scoped, args);
  }) as ReturnType<Schema["requestProjectPlan"]["functionHandler"]>;
