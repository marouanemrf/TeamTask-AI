// Organisation-level isolation: migrates existing data (see amplify/functions/shared/tenancy.ts).
// 1. Puts every account in its organisation's Cognito groups ("<org>", and "<org>:MANAGERS" for
//    ADMIN / PROJECT_MANAGER), so the data API returns their organisation's records.
// 2. Fills organisationId (and managersGroup on manager-only data) on records written before
//    isolation, derived from their project / task / member. Only missing values are set.
// Idempotent. Audit events (TaskEvent) are only touched with --events: run that after the
// backend with the new audit archive is deployed, so the archive files the change under
// "migrations/" (organisationId added, nothing else changed) instead of "tampering/".
//
// Usage: node scripts/migrate-organisation-isolation.mjs <amplify_outputs.json> [--events] [--dry-run]
import { readFileSync } from "node:fs";
import { AppSyncClient, ListGraphqlApisCommand } from "@aws-sdk/client-appsync";
import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient, CreateGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const withEvents = args.includes("--events");
const outputsPath = args.find((a) => !a.startsWith("--"));
const outputs = JSON.parse(readFileSync(outputsPath ?? new URL("../amplify_outputs.json", import.meta.url), "utf8"));
const region = outputs.auth.aws_region;
const userPoolId = outputs.auth.user_pool_id;

const apis = await new AppSyncClient({ region }).send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
if (!api) throw new Error(`No AppSync API found for ${outputs.data.url}`);
const table = (model) => `${model}-${api.apiId}-NONE`;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const cognito = new CognitoIdentityProviderClient({ region });

const scanAll = async (model) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new ScanCommand({ TableName: table(model), ExclusiveStartKey }));
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};
const managersGroupOf = (org) => `${org}:MANAGERS`;
const isManager = (m) => [...(m.roles ?? []), m.role].some((r) => r === "ADMIN" || r === "PROJECT_MANAGER");

// --- 1. Cognito organisation groups ---
const members = await scanAll("TeamMember");
let grouped = 0;
for (const m of members) {
  if (!m.organisationId || !m.email) continue;
  const groups = isManager(m) ? [m.organisationId, managersGroupOf(m.organisationId)] : [m.organisationId];
  for (const group of groups) {
    if (dryRun) continue;
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: group, Description: "TeamTask organisation (data isolation)" })).catch((e) => { if (e.name !== "GroupExistsException") throw e; });
    try {
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: m.email, GroupName: group }));
    } catch (e) {
      if (e.name !== "UserNotFoundException") throw e;
      console.warn(`No sign-in account for ${m.id}: skipped`);
    }
  }
  grouped++;
}
console.log(`Accounts in their organisation groups: ${grouped}${dryRun ? " (dry run)" : ""}`);

// --- 2. organisationId on existing records ---
const orgOf = new Map();
for (const o of await scanAll("Organisation")) orgOf.set(o.id, o.id);
for (const m of members) if (m.organisationId) orgOf.set(m.id, m.organisationId);
for (const t of await scanAll("Team")) if (t.organisationId) orgOf.set(t.id, t.organisationId);
const projects = await scanAll("Project");
for (const p of projects) if (p.organisationId) orgOf.set(p.id, p.organisationId);
const memberOrgByEmail = new Map(members.filter((m) => m.email && m.organisationId).map((m) => [m.email.toLowerCase(), m.organisationId]));

async function backfill(model, resolve, { managers = false } = {}) {
  const items = await scanAll(model);
  let set = 0;
  let unresolved = 0;
  for (const item of items) {
    const org = item.organisationId ?? resolve(item);
    if (org) orgOf.set(item.id, org);
    if (item.organisationId && (!managers || item.managersGroup)) continue;
    if (!org) { unresolved++; continue; }
    if (!dryRun) {
      await db.send(new UpdateCommand({
        TableName: table(model),
        Key: { id: item.id },
        UpdateExpression: managers ? "SET organisationId = if_not_exists(organisationId, :o), managersGroup = if_not_exists(managersGroup, :g)" : "SET organisationId = :o",
        ConditionExpression: managers ? "attribute_exists(id)" : "attribute_exists(id) AND attribute_not_exists(organisationId)",
        ExpressionAttributeValues: managers ? { ":o": org, ":g": managersGroupOf(org) } : { ":o": org },
      }));
    }
    set++;
  }
  console.log(`${model}: ${set} updated, ${unresolved} without a known organisation, ${items.length} in total${dryRun ? " (dry run)" : ""}`);
}

const byProject = (r) => orgOf.get(r.projectId);
await backfill("Milestone", byProject);
await backfill("Task", byProject);
await backfill("WeeklyReport", byProject);
await backfill("Dependency", (d) => orgOf.get(d.fromTaskId) ?? orgOf.get(d.toTaskId));
await backfill("Reminder", (r) => orgOf.get(r.taskId), { managers: true });
await backfill("Escalation", (e) => orgOf.get(e.taskId), { managers: true });
await backfill("AIRecommendation", byProject, { managers: true });
await backfill("Approval", (a) => orgOf.get(a.recommendationId), { managers: true });
await backfill("Presence", (p) => memberOrgByEmail.get(String(p.email ?? "").toLowerCase()));
if (withEvents) await backfill("TaskEvent", (e) => orgOf.get(e.entityId));
else console.log("TaskEvent: skipped (run again with --events once the new backend is deployed)");
