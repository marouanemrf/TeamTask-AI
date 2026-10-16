// Aligns the sandbox demo data with the proposal's sample plan (section 6):
// - adds Nadia, Risk Analyst (MEMBER) with a sign-in account (no invitation email is sent);
// - assigns "Incident response review" to her (proposal owner: Risk Analyst), with an audit event.
// Idempotent: re-running changes nothing. Usage: node scripts/align-demo-data.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AppSyncClient, ListGraphqlApisCommand } from "@aws-sdk/client-appsync";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const NADIA = {
  name: "Nadia",
  email: "nadia@gogosecurity.test",
  username: "nadia",
  jobTitle: "Risk Analyst",
  skills: ["Incident response", "Risk analysis"],
  role: "MEMBER",
};
const TASK_TITLE = "Incident response review";

const outputs = JSON.parse(readFileSync(new URL("../amplify_outputs.json", import.meta.url), "utf8"));
const region = outputs.auth.aws_region;
const userPoolId = outputs.auth.user_pool_id;

const appsync = new AppSyncClient({ region });
const apis = await appsync.send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
if (!api) throw new Error(`No AppSync API found for ${outputs.data.url}`);
const table = (model) => `${model}-${api.apiId}-NONE`;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
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
const now = new Date().toISOString();

// --- Sign-in account (MEMBER group), no email sent to the .test address ---
const cognito = new CognitoIdentityProviderClient({ region });
let username;
try {
  username = (await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: NADIA.email }))).Username;
  console.log("Cognito user already exists:", NADIA.email);
} catch (error) {
  if (error.name !== "UserNotFoundException") throw error;
  const created = await cognito.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: NADIA.email,
    MessageAction: "SUPPRESS",
    UserAttributes: [
      { Name: "email", Value: NADIA.email },
      { Name: "email_verified", Value: "true" },
      { Name: "name", Value: NADIA.name },
    ],
  }));
  username = created.User.Username;
  console.log("Cognito user created:", NADIA.email);
}
await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: NADIA.role }));

// --- TeamMember in the organisation ---
const [organisation] = await scanAll("Organisation");
if (!organisation) throw new Error("No organisation found: sign in once as ADMIN first.");
const members = await scanAll("TeamMember");
let nadia = members.find((m) => m.email?.toLowerCase() === NADIA.email);
if (!nadia) {
  nadia = {
    id: randomUUID(),
    __typename: "TeamMember",
    organisationId: organisation.id,
    name: NADIA.name,
    email: NADIA.email,
    username: NADIA.username,
    role: NADIA.role,
    roles: [NADIA.role],
    jobTitle: NADIA.jobTitle,
    skills: NADIA.skills,
    weeklyCapacityHours: 40,
    createdAt: now,
    updatedAt: now,
  };
  await db.send(new PutCommand({ TableName: table("TeamMember"), Item: nadia, ConditionExpression: "attribute_not_exists(id)" }));
  console.log("TeamMember created:", nadia.id);
} else {
  console.log("TeamMember already exists:", nadia.id);
}

// --- Assign "Incident response review" to her, audited ---
const tasks = (await scanAll("Task")).filter((t) => t.title === TASK_TITLE);
if (tasks.length === 0) console.log(`No task named "${TASK_TITLE}" found.`);
for (const task of tasks) {
  if (task.assigneeId === nadia.id) {
    console.log(`"${TASK_TITLE}" (${task.id}) is already assigned to Nadia.`);
    continue;
  }
  await db.send(new UpdateCommand({
    TableName: table("Task"),
    Key: { id: task.id },
    UpdateExpression: "SET assigneeId = :a, updatedAt = :u",
    ExpressionAttributeValues: { ":a": nadia.id, ":u": now },
  }));
  const requestId = randomUUID();
  await db.send(new PutCommand({
    TableName: table("TaskEvent"),
    Item: {
      id: `${requestId}:ASSIGNED`,
      __typename: "TaskEvent",
      entityId: task.id,
      eventType: "ASSIGNED",
      actorType: "SYSTEM",
      actorEmail: null,
      before: JSON.stringify({ assigneeId: task.assigneeId ?? null }),
      after: JSON.stringify({ assigneeId: nadia.id, reason: "Proposal sample plan: Risk Analyst" }),
      requestId,
      createdAt: now,
      updatedAt: now,
    },
    ConditionExpression: "attribute_not_exists(id)",
  }));
  console.log(`"${TASK_TITLE}" (${task.id}) assigned to Nadia.`);
}
