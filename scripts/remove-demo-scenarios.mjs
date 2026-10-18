// Removes the data set written by seed-demo-scenarios.mjs: every record whose id starts with
// "demo-", plus the @gogosecurity.test sign-in accounts. Audit events already copied to the
// Object Lock archive stay there until their retention ends (by design).
// Usage: node scripts/remove-demo-scenarios.mjs <path to amplify_outputs.json>
import { readFileSync } from "node:fs";
import { AppSyncClient, ListGraphqlApisCommand } from "@aws-sdk/client-appsync";
import { AdminDeleteUserCommand, CognitoIdentityProviderClient, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const outputs = JSON.parse(readFileSync(process.argv[2] ?? new URL("../amplify_outputs.json", import.meta.url), "utf8"));
const region = outputs.auth.aws_region;
const apis = await new AppSyncClient({ region }).send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
if (!api) throw new Error(`No AppSync API found for ${outputs.data.url}`);
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const MODELS = ["TaskEvent", "Reminder", "Escalation", "Dependency", "Task", "Milestone", "WeeklyReport", "AIRecommendation", "Project", "TeamMember", "Team"];
for (const model of MODELS) {
  const TableName = `${model}-${api.apiId}-NONE`;
  let removed = 0;
  let ExclusiveStartKey;
  do {
    const page = await db.send(new ScanCommand({ TableName, ExclusiveStartKey, ProjectionExpression: "id, projectId" }));
    for (const item of page.Items ?? []) {
      // Weekly reports and AI plans generated for the demo projects have generated ids: match them by project.
      if (item.id.startsWith("demo-") || item.projectId?.startsWith("demo-")) {
        await db.send(new DeleteCommand({ TableName, Key: { id: item.id } }));
        removed++;
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`${model}: ${removed} removed`);
}

const cognito = new CognitoIdentityProviderClient({ region });
for (const key of ["youssef", "salma", "karim", "sara", "lina", "omar", "nadia", "hamza"]) {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: outputs.auth.user_pool_id, Username: `${key}@gogosecurity.test` }));
    console.log("Account removed:", key);
  } catch (error) {
    if (!(error instanceof UserNotFoundException)) throw error;
  }
}
