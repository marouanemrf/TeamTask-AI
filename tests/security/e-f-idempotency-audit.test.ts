import { describe, expect, it } from "vitest";
import { M, Q } from "./documents";
import { as, aws, enabled, fx, isDenied, record, summary, uuid } from "./helpers";

const eventsFor = async (requestId: string) =>
  ((await as("A_ADMIN", Q.listTaskEventsByRequest, { r: requestId })).data?.listTaskEventByRequestId as { items: { id: string; eventType: string }[] } | null)?.items ?? [];

describe.skipIf(!enabled)("e. idempotency", () => {
  it("addTask twice with the same clientRequestId → one task, one CREATED event", async () => {
    const vars = { clientRequestId: uuid(), projectId: fx.projects.A.id, title: "sec idempotent create", assigneeId: fx.users.A_MEMBER.memberId };
    const first = await as("A_PM", M.addTask, vars);
    const second = await as("A_PM", M.addTask, vars);
    const ids = [first, second].map((r) => (r.data?.addTask as { id?: string } | null)?.id);
    const events = await eventsFor(vars.clientRequestId);
    const pass = !!ids[0] && ids[0] === ids[1] && events.length === 1;
    record({ category: "e. Idempotency", name: "addTask replayed", request: "addTask ×2, same clientRequestId", expected: "same task id, 1 TaskEvent", actual: `ids=${ids.join(",")} events=${events.length}`, pass });
    expect(pass).toBe(true);
  });

  it("addTask sent 5 times concurrently with the same clientRequestId → one task, one event", async () => {
    const vars = { clientRequestId: uuid(), projectId: fx.projects.A.id, title: "sec idempotent concurrent", assigneeId: fx.users.A_MEMBER.memberId };
    const results = await Promise.all(Array.from({ length: 5 }, () => as("A_PM", M.addTask, vars)));
    const ids = new Set(results.map((r) => (r.data?.addTask as { id?: string } | null)?.id).filter(Boolean));
    const tasks = ((await as("A_ADMIN", Q.listTasks)).data?.listTasks as { items: { title: string }[] }).items.filter((t) => t.title === vars.title);
    const events = await eventsFor(vars.clientRequestId);
    const pass = ids.size === 1 && tasks.length === 1 && events.length === 1;
    record({ category: "e. Idempotency", name: "addTask concurrent replay", request: "5 × addTask in parallel, same clientRequestId", expected: "1 task, 1 TaskEvent", actual: `distinct ids=${ids.size} tasks=${tasks.length} events=${events.length} · ${results.map(summary).join(" / ").slice(0, 200)}`, pass });
    expect(pass).toBe(true);
  });

  it("changeTaskStatus replayed → one STATUS_CHANGED event", async () => {
    const vars = { clientRequestId: uuid(), taskId: fx.tasks.A.id, status: "IN_PROGRESS" };
    await as("A_MEMBER", M.changeTaskStatus, vars);
    await as("A_MEMBER", M.changeTaskStatus, vars);
    const events = await eventsFor(vars.clientRequestId);
    const pass = events.length <= 1;
    record({ category: "e. Idempotency", name: "changeTaskStatus replayed", request: "changeTaskStatus ×2, same clientRequestId", expected: "≤ 1 TaskEvent", actual: `events=${events.length}`, pass });
    expect(pass).toBe(true);
  });
});

describe.skipIf(!enabled)("f. audit immutability", () => {
  it("no client can create, update or delete a TaskEvent", async () => {
    const someEvent = ((await as("A_ADMIN", Q.listTaskEvents)).data?.listTaskEvents as { items: { id: string }[] }).items[0];
    for (const key of ["A_ADMIN", "A_PM", "A_MEMBER", "A_VIEWER"] as const) {
      const tries = [
        ["createTaskEvent", await as(key, M.createTaskEvent, { input: { entityId: fx.tasks.A.id, eventType: "UPDATED", actorType: "USER" } })],
        ["updateTaskEvent", await as(key, M.updateTaskEvent, { input: { id: someEvent.id, eventType: "UPDATED" } })],
        ["deleteTaskEvent", await as(key, M.deleteTaskEvent, { input: { id: someEvent.id } })],
      ] as const;
      for (const [op, r] of tries) {
        const pass = isDenied(r);
        record({ category: "f. Audit immutability", name: `${op} as ${key}`, request: `${op} as ${key}`, expected: "denied", actual: summary(r), pass });
        expect(pass).toBe(true);
      }
    }
  });

  it("no logEvent call can write a task event (task events come only from the task API)", async () => {
    const r = await as("A_ADMIN", M.logEvent, { clientRequestId: uuid(), entityId: fx.tasks.A.id, eventType: "STATUS_CHANGED" });
    const pass = r.errors.length > 0 && r.data?.logEvent == null;
    record({ category: "f. Audit immutability", name: "logEvent forging a task event", request: "logEvent entityId=<task> as ADMIN", expected: "rejected", actual: summary(r), pass });
    expect(pass).toBe(true);
  });

  it("task function roles: no direct DynamoDB update/delete, and AppSync access reviewed", () => {
    const roles = (JSON.parse(aws(["iam", "list-roles", "--query", "Roles[?contains(RoleName,'createtasklambda') || contains(RoleName,'updatetasklambda') || contains(RoleName,'changetaskstatus')].Arn"])) as string[]);
    for (const arn of roles) {
      const sim = JSON.parse(aws(["iam", "simulate-principal-policy", "--policy-source-arn", arn, "--action-names", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:PutItem", "--resource-arns", `arn:aws:dynamodb:${fx.region}:*:table/TaskEvent-*`])) as { EvaluationResults: { EvalActionName: string; EvalDecision: string }[] };
      const decisions = sim.EvaluationResults.map((e) => `${e.EvalActionName}=${e.EvalDecision}`);
      const pass = sim.EvaluationResults.every((e) => e.EvalDecision !== "allowed");
      record({ category: "f. Audit immutability", name: `IAM simulation ${arn.split("/").pop()}`, request: "simulate-principal-policy dynamodb Update/Delete/PutItem on TaskEvent table", expected: "denied", actual: decisions.join(", "), pass });
      expect(pass).toBe(true);
    }
    expect(roles.length).toBeGreaterThan(0);
  });

  it("task function roles cannot call deleteTaskEvent / updateTaskEvent through AppSync", () => {
    const apis = JSON.parse(aws(["appsync", "list-graphql-apis"])) as { graphqlApis: { arn: string; uris: { GRAPHQL: string } }[] };
    const api = apis.graphqlApis.find((a) => a.uris.GRAPHQL === fx.apiUrl)!;
    const roles = JSON.parse(aws(["iam", "list-roles", "--query", "Roles[?contains(RoleName,'lambda') && contains(RoleName,'teamtaskai')].Arn"])) as string[];
    for (const arn of roles) {
      const sim = JSON.parse(aws(["iam", "simulate-principal-policy", "--policy-source-arn", arn, "--action-names", "appsync:GraphQL",
        "--resource-arns", `${api.arn}/types/Mutation/fields/deleteTaskEvent`, `${api.arn}/types/Mutation/fields/updateTaskEvent`])) as { EvaluationResults: { EvalResourceName: string; EvalDecision: string }[] };
      const decisions = sim.EvaluationResults.map((e) => `${e.EvalResourceName.split("/").pop()}=${e.EvalDecision}`);
      const pass = sim.EvaluationResults.every((e) => e.EvalDecision !== "allowed");
      record({ category: "f. Audit immutability", name: `AppSync delete/update TaskEvent – ${arn.split("/").pop()}`, request: "simulate appsync:GraphQL Mutation.deleteTaskEvent / updateTaskEvent", expected: "denied", actual: decisions.join(", "), pass });
    }
    expect(roles.length).toBeGreaterThan(0);
  });
});
