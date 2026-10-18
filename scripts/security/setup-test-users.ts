/**
 * Security test fixtures (proposal step 7). Creates, idempotently:
 * - Cognito users with permanent passwords (no invitation email is sent):
 *     org A (the existing organisation): ADMIN, PROJECT_MANAGER, MEMBER, VIEWER
 *     org B (a second organisation):     PROJECT_MANAGER
 * - their TeamMember records and organisation groups (data isolation: "<org>" and, for managers,
 *   "<org>:MANAGERS"), org B, one project + one task per org (org A's task is assigned to the
 *   MEMBER, so "own task" rules can be tested).
 * Writes the ids to tests/security/.fixtures.json (git-ignored).
 *
 * Passwords come from the environment, never from the repo:
 *   SEC_TEST_PASSWORD   one password for every test user (Cognito policy: 8+ chars, upper, lower,
 *                       digit, symbol), or SEC_PASSWORD_<KEY> per user (KEY = A_ADMIN, A_PM,
 *                       A_MEMBER, A_VIEWER, B_PM).
 *   SEC_EMAIL_DOMAIN    optional, default "security.gogosecurity.test" (reserved TLD: no mail).
 * Usage: SEC_TEST_PASSWORD='…' npx tsx scripts/security/setup-test-users.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AppSyncClient, ListGraphqlApisCommand } from "@aws-sdk/client-appsync";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const USER_KEYS = ["A_ADMIN", "A_PM", "A_MEMBER", "A_VIEWER", "B_PM"] as const;
export type UserKey = (typeof USER_KEYS)[number];
const ROLE: Record<UserKey, string> = { A_ADMIN: "ADMIN", A_PM: "PROJECT_MANAGER", A_MEMBER: "MEMBER", A_VIEWER: "VIEWER", B_PM: "PROJECT_MANAGER" };

const domain = process.env.SEC_EMAIL_DOMAIN ?? "security.gogosecurity.test";
const emailOf = (key: UserKey) => `sec-${key.toLowerCase().replace("_", "-")}@${domain}`;
function passwordOf(key: UserKey): string {
  const value = process.env[`SEC_PASSWORD_${key}`] ?? process.env.SEC_TEST_PASSWORD;
  if (!value) throw new Error(`Set SEC_TEST_PASSWORD (or SEC_PASSWORD_${key}) in the environment.`);
  return value;
}

const outputs = JSON.parse(readFileSync(new URL("../../amplify_outputs.json", import.meta.url), "utf8"));
const region: string = outputs.auth.aws_region;
const userPoolId: string = outputs.auth.user_pool_id;

const apis = await new AppSyncClient({ region }).send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis?.find((a) => a.uris?.GRAPHQL === outputs.data.url);
if (!api?.apiId) throw new Error(`No AppSync API found for ${outputs.data.url}`);
const table = (model: string) => `${model}-${api.apiId}-NONE`;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const cognito = new CognitoIdentityProviderClient({ region });
const now = new Date().toISOString();

async function scanAll(model: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ TableName: table(model), ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function putOnce(model: string, item: Record<string, unknown>) {
  try {
    await db.send(new PutCommand({ TableName: table(model), Item: { __typename: model, createdAt: now, updatedAt: now, ...item }, ConditionExpression: "attribute_not_exists(id)" }));
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
  }
}

async function ensureUser(key: UserKey): Promise<string> {
  const email = emailOf(key);
  let sub: string | undefined;
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    sub = user.UserAttributes?.find((a) => a.Name === "sub")?.Value;
  } catch (error) {
    if ((error as { name?: string }).name !== "UserNotFoundException") throw error;
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: `Security ${key}` },
      ],
    }));
    sub = created.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
  }
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: email, Password: passwordOf(key), Permanent: true }));
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: ROLE[key] }));
  if (!sub) throw new Error(`No sub for ${email}`);
  return sub;
}

// --- Organisations ---
const organisations = await scanAll("Organisation");
const orgA = organisations.find((o) => o.id !== "sec-org-b");
if (!orgA) throw new Error("Org A missing: sign in once as ADMIN so the organisation is created.");
const orgAId = String(orgA.id);
const orgBId = "sec-org-b";
await putOnce("Organisation", { id: orgBId, name: "Security test org B" });

// --- Users and their team records ---
const users: Record<string, { email: string; role: string; org: string; memberId: string; sub: string }> = {};
for (const key of USER_KEYS) {
  const sub = await ensureUser(key);
  const org = key.startsWith("A_") ? orgAId : orgBId;
  const memberId = `sec-member-${key.toLowerCase()}`;
  await putOnce("TeamMember", {
    id: memberId,
    organisationId: org,
    name: `Security ${key}`,
    email: emailOf(key),
    username: `sec-${key.toLowerCase().replace("_", "-")}`,
    role: ROLE[key],
    roles: [ROLE[key]],
    skills: ["Security testing"],
    weeklyCapacityHours: 40,
  });
  // Organisation groups: what lets the data API return this organisation's records to the user.
  const groups = ROLE[key] === "ADMIN" || ROLE[key] === "PROJECT_MANAGER" ? [org, `${org}:MANAGERS`] : [org];
  for (const group of groups) {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: group })).catch((error: Error) => { if (error.name !== "GroupExistsException") throw error; });
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: emailOf(key), GroupName: group }));
  }
  users[key] = { email: emailOf(key), role: ROLE[key], org, memberId, sub };
}

// --- One project + one task per organisation ---
const today = now.slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const projects = {
  A: { id: "sec-project-a", organisationId: orgAId, name: "Security test project A", clientName: "Security", status: "ACTIVE", startDate: today, endDate: inDays(30), managerEmail: users.A_PM.email, businessImpact: "HIGH" },
  B: { id: "sec-project-b", organisationId: orgBId, name: "Security test project B", clientName: "Org B", status: "ACTIVE", startDate: today, endDate: inDays(30), managerEmail: users.B_PM.email, businessImpact: "HIGH" },
};
const tasks = {
  A: { id: "sec-task-a", organisationId: orgAId, projectId: projects.A.id, title: "Security test task A", status: "TODO", priority: "HIGH", dueDate: inDays(5), estimatedHours: 4, requiredSkills: [], createdBy: "HUMAN", assigneeId: users.A_MEMBER.memberId },
  B: { id: "sec-task-b", organisationId: orgBId, projectId: projects.B.id, title: "Security test task B", status: "TODO", priority: "HIGH", dueDate: inDays(5), estimatedHours: 4, requiredSkills: [], createdBy: "HUMAN", assigneeId: users.B_PM.memberId },
};
// Reset on every run: earlier runs may have changed them (status, assignee, cancellation).
const reset = (model: string, item: Record<string, unknown>) =>
  db.send(new PutCommand({ TableName: table(model), Item: { __typename: model, createdAt: now, updatedAt: now, ...item } }));
for (const p of Object.values(projects)) await reset("Project", p);
for (const t of Object.values(tasks)) await reset("Task", t);

mkdirSync(new URL("../../tests/security/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../../tests/security/.fixtures.json", import.meta.url),
  JSON.stringify({ region, userPoolId, identityPoolId: outputs.auth.identity_pool_id, bucket: outputs.storage.bucket_name, apiUrl: outputs.data.url, restApiUrl: outputs.custom?.teamtaskApi?.url ?? null, clientId: outputs.auth.user_pool_client_id, orgAId, orgBId, users, projects, tasks }, null, 2),
);
console.log(`Fixtures ready: ${USER_KEYS.length} users, org A ${orgAId}, org B ${orgBId}.`);
