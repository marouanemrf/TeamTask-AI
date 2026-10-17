import { env } from "$amplify/env/plan-workflow";
import { askModel } from "../shared/aiModel";
import { check, createDataClient, getProject } from "../shared/data";
import { projectUrl } from "../shared/emailTemplates";
import { sendEmail, postToChat } from "../shared/notify";
import { loadPlanContext, planTaskRequestId, readPayload } from "../shared/planData";
import type { PlanPayload } from "../shared/planData";
import { creationOrder, extractJson, normalisePlan, PLAN_SYSTEM_PROMPT, planPrompt } from "../shared/planning";
import { createTaskRecord } from "../shared/taskCreate";

const client = await createDataClient(env);

/**
 * Steps of the plan approval state machine (amplify/custom/workflows). Each step reads the
 * recommendation again: the state only carries its id.
 *   generate → the model proposes a plan, code checks it (owners, dates, links)
 *   wait     → stores the task token and marks the plan PENDING (the machine waits for a decision)
 *   apply    → after approval, creates the approved tasks with the normal task rules (idempotent)
 *   expire / fail → final states
 */
type WorkflowEvent =
  | { action: "generate"; recommendationId: string }
  | { action: "wait"; recommendationId: string; taskToken: string }
  | { action: "apply"; recommendationId: string }
  | { action: "expire"; recommendationId: string }
  | { action: "fail"; recommendationId: string; error?: unknown };

class UnusablePlan extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusablePlan";
  }
}

async function getRecommendation(id: string) {
  const record = check(await client.models.AIRecommendation.get({ id }), "AIRecommendation.get");
  if (!record) throw new Error(`recommendation ${id} not found`);
  return record;
}

async function save(id: string, changes: { status?: "GENERATING" | "PENDING" | "APPLIED" | "EXPIRED" | "FAILED"; payload?: PlanPayload; rationale?: string; workflowToken?: string | null; error?: string | null }) {
  const { payload, ...rest } = changes;
  check(await client.models.AIRecommendation.update({ id, ...rest, ...(payload ? { payload: JSON.stringify(payload) } : {}) }), "AIRecommendation.update");
}

/** Readable message from a Step Functions error object ({ Error, Cause }). */
function errorText(error: unknown): string {
  const e = (error ?? {}) as { Error?: string; Cause?: string };
  let cause = e.Cause ?? "";
  try {
    cause = (JSON.parse(cause) as { errorMessage?: string }).errorMessage ?? cause;
  } catch {
    /* plain text */
  }
  return (cause || e.Error || "The workflow failed.").replace(/^\[[A-Z_]+\]\s*/, "").slice(0, 500);
}

export const handler = async (event: WorkflowEvent) => {
  const rec = await getRecommendation(event.recommendationId);
  const payload = readPayload(rec);

  switch (event.action) {
    case "generate": {
      if (rec.status !== "GENERATING") return { skipped: rec.status };
      const project = await getProject(client, rec.projectId);
      const ctx = await loadPlanContext(client, project, payload.scope);
      const answer = await askModel(PLAN_SYSTEM_PROMPT, planPrompt(ctx), 6000, 0.2);
      console.info(JSON.stringify({ fn: "plan-workflow", step: "generate", recommendationId: rec.id, stopReason: answer.stopReason, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens }));
      if (answer.stopReason === "guardrail_intervened") throw new UnusablePlan("The request was blocked by the safety filter. Rephrase the scope.");
      const { plan, errors } = normalisePlan(extractJson(answer.text), ctx, "AI");
      if (!plan) throw new UnusablePlan(errors.join(" ") || "The AI answer couldn't be used. Try again.");
      await save(rec.id, { payload: { ...payload, plan, model: answer.modelId, generatedAt: new Date().toISOString() }, rationale: plan.summary });
      check(await client.models.TaskEvent.create({
        id: `${rec.id}:AI_PROPOSED`,
        entityId: rec.projectId,
        eventType: "AI_PROPOSED",
        actorType: "AI",
        actorEmail: rec.requestedBy,
        after: JSON.stringify({ recommendationId: rec.id, tasks: plan.tasks.length, warnings: plan.warnings.length, model: answer.modelId }),
        requestId: `${rec.id}:AI_PROPOSED`,
      }), "TaskEvent.create");
      return { tasks: plan.tasks.length };
    }

    case "wait": {
      await save(rec.id, { status: "PENDING", workflowToken: event.taskToken });
      const project = await getProject(client, rec.projectId);
      const link = projectUrl(env.APP_URL, project.id);
      const text = `An AI plan for “${project.name}” (${payload.plan?.tasks.length ?? 0} tasks) is waiting for approval.`;
      if (project.managerEmail && project.managerEmail.toLowerCase() !== (rec.requestedBy ?? "").toLowerCase()) {
        await sendEmail(project.managerEmail, env.SENDER_EMAIL, { subject: `Plan to approve: ${project.name}`, heading: "A plan is waiting for your approval", body: `${text} Nothing is created until a manager approves it.`, link, linkLabel: "Review the plan" });
      }
      await postToChat(text, { url: link, label: "Review the plan" });
      return { waiting: true };
    }

    case "apply": {
      if (rec.status === "APPLIED") return { created: Object.keys(payload.createdTaskIds ?? {}).length };
      if (rec.status !== "APPROVED" || !payload.approvedPlan) throw new Error(`recommendation ${rec.id} is not approved`);
      const idByKey: Record<string, string> = { ...(payload.createdTaskIds ?? {}) };
      for (const task of creationOrder(payload.approvedPlan.tasks)) {
        const created = await createTaskRecord(client, { email: payload.decidedBy ?? rec.requestedBy ?? "" }, {
          clientRequestId: planTaskRequestId(rec.id, task.key),
          projectId: rec.projectId,
          title: task.title,
          description: task.description || null,
          priority: task.priority,
          status: "TODO",
          dueDate: task.dueDate,
          estimatedHours: task.estimatedHours,
          requiredSkills: task.requiredSkills,
          assigneeId: task.assigneeId,
          parentTaskId: task.parentKey ? idByKey[task.parentKey] : null,
          dependsOn: task.dependsOn.map((k) => idByKey[k]).filter(Boolean),
        }, "AI");
        idByKey[task.key] = created.id;
      }
      await save(rec.id, { status: "APPLIED", workflowToken: null, payload: { ...payload, createdTaskIds: idByKey } });
      return { created: Object.keys(idByKey).length };
    }

    case "expire":
      if (rec.status === "PENDING") await save(rec.id, { status: "EXPIRED", workflowToken: null, error: "No decision was taken in time." });
      return { expired: true };

    case "fail":
      await save(rec.id, { status: "FAILED", workflowToken: null, error: errorText(event.error) });
      return { failed: true };
  }
};
