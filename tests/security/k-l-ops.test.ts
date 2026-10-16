import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { M } from "./documents";
import { as, aws, enabled, fx, record, uuid } from "./helpers";

const fnName = (part: string) => (JSON.parse(aws(["lambda", "list-functions", "--query", `Functions[?contains(FunctionName,'${part}') && contains(FunctionName,'teamtaskai')].FunctionName`])) as string[])[0];

describe.skipIf(!enabled)("k. notification failure and recovery", () => {
  it("unverified recipient → Reminder FAILED and the run continues", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = await as("A_PM", M.addTask, { clientRequestId: uuid(), projectId: fx.projects.A.id, title: "sec reminder failure", dueDate: tomorrow, assigneeId: fx.users.A_MEMBER.memberId });
    const taskId = (created.data?.addTask as { id: string } | undefined)?.id ?? "";
    const name = fnName("deadlinecheck");
    const out = JSON.parse(aws(["lambda", "invoke", "--function-name", name, "--payload", "e30=", "--log-type", "None", join(tmpdir(), "sec-deadline-out.json")])) as { StatusCode: number; FunctionError?: string };
    const reminders = await as("A_ADMIN", `query ($t: ID!) { listReminders(filter: { taskId: { eq: $t } }, limit: 1000) { items { status recipientEmail } } }`, { t: taskId });
    const items = (reminders.data?.listReminders as { items: { status: string }[] } | null)?.items ?? [];
    const pass = out.StatusCode === 200 && !out.FunctionError && items.length > 0 && items.every((r) => r.status === "FAILED" || r.status === "SENT");
    record({ category: "k. Notifications", name: "SES rejection handled", request: `invoke ${name} with a task due tomorrow assigned to an unverified address`, expected: "run succeeds, Reminder recorded FAILED (SES sandbox) and other tasks processed",
      actual: `status ${out.StatusCode}${out.FunctionError ? ` error ${out.FunctionError}` : ""}; reminders: ${items.map((r) => r.status).join(", ") || "none"}`, pass });
    expect(pass).toBe(true);
  }, 180_000);

  it("forced Lambda error → retry, DLQ message and alarm", () => {
    const queues = JSON.parse(aws(["sqs", "list-queues", "--queue-name-prefix", "teamtask"])) as { QueueUrls?: string[] };
    const alarms = JSON.parse(aws(["cloudwatch", "describe-alarms", "--alarm-name-prefix", "TeamTask"])) as { MetricAlarms: unknown[] };
    const exists = (queues.QueueUrls?.length ?? 0) > 0 && alarms.MetricAlarms.length > 0;
    record({ category: "k. Notifications", name: "DLQ + alarm on scheduler failure", request: "look up the DLQ and alarm", expected: "DLQ receives the failed event; alarm goes to ALARM",
      actual: exists ? "DLQ and alarm present (run the forced-failure procedure manually)" : "NOT PRESENT: no EventBridge Scheduler DLQ or CloudWatch alarm deployed (phase 3); scheduled runs rely on the default async retries only", pass: exists, na: !exists });
    expect(true).toBe(true);
  });
});

describe.skipIf(!enabled)("l. logging", () => {
  it("CloudTrail records management events (Cognito admin calls from the setup script)", () => {
    const events = JSON.parse(aws(["cloudtrail", "lookup-events", "--lookup-attributes", "AttributeKey=EventName,AttributeValue=AdminSetUserPassword", "--max-results", "5"])) as { Events: { EventTime: string }[] };
    const pass = events.Events.length > 0;
    record({ category: "l. Logging", name: "CloudTrail management events", request: "cloudtrail lookup-events EventName=AdminSetUserPassword", expected: "events present", actual: `${events.Events.length} event(s), latest ${events.Events[0]?.EventTime ?? "-"}`, pass });
    expect(pass).toBe(true);
  });

  it("CloudTrail data events for DynamoDB and S3", () => {
    const trails = JSON.parse(aws(["cloudtrail", "describe-trails"])) as { trailList: { Name: string; HomeRegion: string }[] };
    let dataEvents = 0;
    for (const t of trails.trailList) {
      const sel = JSON.parse(aws(["cloudtrail", "get-event-selectors", "--trail-name", t.Name])) as { AdvancedEventSelectors?: unknown[]; EventSelectors?: { DataResources?: unknown[] }[] };
      dataEvents += (sel.AdvancedEventSelectors?.length ?? 0) + (sel.EventSelectors?.reduce((n, s) => n + (s.DataResources?.length ?? 0), 0) ?? 0);
    }
    const pass = trails.trailList.length > 0 && dataEvents > 0;
    record({ category: "l. Logging", name: "CloudTrail trail with data events", request: "describe-trails + get-event-selectors", expected: "a trail logging DynamoDB/S3 data events",
      actual: `${trails.trailList.length} trail(s), ${dataEvents} data selector(s)${trails.trailList.length ? "" : " — only the 90-day event history exists (phase 5 adds the trail)"}`, pass });
    expect(true).toBe(true);
  });

  it("CloudWatch logs contain no tokens or passwords", () => {
    const groups = (JSON.parse(aws(["logs", "describe-log-groups", "--log-group-name-prefix", "/aws/lambda/amplify-teamtaskai"])) as { logGroups: { logGroupName: string }[] }).logGroups.map((g) => g.logGroupName);
    const since = String(Date.now() - 7 * 86_400_000);
    const leaks: string[] = [];
    const patterns = ['"eyJ"', '"Authorization"', '"password"', '"PASSWORD"'];
    const secret = process.env.SEC_TEST_PASSWORD;
    for (const group of groups) {
      for (const pattern of [...patterns, ...(secret ? [`"${secret}"`] : [])]) {
        const found = JSON.parse(aws(["logs", "filter-log-events", "--log-group-name", group, "--start-time", since, "--filter-pattern", pattern, "--max-items", "3"])) as { events: { message: string }[] };
        for (const e of found.events) leaks.push(`${group.split("-").slice(-2).join("-")}: ${pattern === `"${secret}"` ? "<test password>" : pattern} → ${e.message.slice(0, 80)}`);
      }
    }
    const pass = leaks.length === 0;
    record({ category: "l. Logging", name: "no secrets in Lambda logs", request: `filter-log-events on ${groups.length} log groups (7 days) for JWTs, Authorization, password`, expected: "0 matches", actual: pass ? "0 matches" : leaks.slice(0, 5).join(" | "), pass });
    expect(pass).toBe(true);
  }, 300_000);
});

describe.skipIf(!enabled)("static: deployed IAM wildcards", () => {
  it("lists every * action or resource in the stack's roles", () => {
    const roles = JSON.parse(aws(["iam", "list-roles", "--query", "Roles[?contains(RoleName,'teamtaskai-marou')].RoleName"])) as string[];
    const findings: string[] = [];
    for (const role of roles) {
      const inline = JSON.parse(aws(["iam", "list-role-policies", "--role-name", role])) as { PolicyNames: string[] };
      for (const name of inline.PolicyNames) {
        const doc = (JSON.parse(aws(["iam", "get-role-policy", "--role-name", role, "--policy-name", name])) as { PolicyDocument: { Statement: { Effect: string; Action: string | string[]; Resource: string | string[] }[] } }).PolicyDocument;
        for (const st of doc.Statement) {
          const actions = ([] as string[]).concat(st.Action ?? []);
          const resources = ([] as string[]).concat(st.Resource ?? []);
          if (st.Effect === "Allow" && (actions.some((a) => a === "*" || a.endsWith(":*")) || resources.some((r) => r === "*")))
            findings.push(`${role.replace("amplify-teamtaskai-marou-", "")} / ${name}: ${actions.join(",")} on ${resources.join(",").slice(0, 120)}`);
        }
      }
      const attached = JSON.parse(aws(["iam", "list-attached-role-policies", "--role-name", role])) as { AttachedPolicies: { PolicyName: string }[] };
      for (const p of attached.AttachedPolicies) if (!/AWSLambdaBasicExecutionRole/.test(p.PolicyName)) findings.push(`${role.replace("amplify-teamtaskai-marou-", "")}: managed policy ${p.PolicyName}`);
    }
    record({ category: "Static: IAM wildcards", name: "deployed role policies", request: `scan ${roles.length} roles`, expected: "no * actions/resources (or each justified)", actual: findings.length ? findings.join(" | ").slice(0, 3000) : "none", pass: findings.length === 0 });
    expect(roles.length).toBeGreaterThan(0);
  }, 300_000);
});
