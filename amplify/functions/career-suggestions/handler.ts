import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ScanCommandInput } from "@aws-sdk/lib-dynamodb";
import { identityFromClaims } from "../assistant-chat/chatCore";
import { isProfileTooThin, parseSuggestions, profilePrompt, SYSTEM_PROMPT } from "./careerCore";
import type { CareerProfile } from "./careerCore";

/**
 * POST /profile/career-suggestions — AI career suggestions from the caller's OWN profile.
 * Identity from the Cognito authorizer; the profile is read on the server (nothing from the body);
 * Bedrock (Converse) with the assistant's guardrail; output checked by code; 20 calls/user/hour.
 */
interface ApiEvent {
  headers?: Record<string, string | undefined>;
  requestContext?: { authorizer?: { claims?: Record<string, unknown> } };
}

const RATE_LIMIT_PER_HOUR = 20;
const bedrock = new BedrockRuntimeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function scan<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as T[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

function respond(event: ApiEvent, statusCode: number, body: unknown) {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: ApiEvent) => {
  const identity = identityFromClaims(event.requestContext?.authorizer?.claims);
  if (!identity) return respond(event, 401, { error: { code: "UNAUTHORIZED", message: "Sign in again." } });
  if (!identity.emailVerified) return respond(event, 403, { error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email address first." } });

  // Rate limit (own counter, separate from the assistant's).
  const now = new Date();
  const counter = await db.send(new UpdateCommand({
    TableName: process.env.ASSISTANT_TABLE!,
    Key: { pk: `RATE#career#${identity.userId}`, sk: now.toISOString().slice(0, 13) },
    UpdateExpression: "ADD #n :one SET expiresAt = if_not_exists(expiresAt, :exp)",
    ExpressionAttributeNames: { "#n": "count" },
    ExpressionAttributeValues: { ":one": 1, ":exp": Math.floor(Date.now() / 1000) + 7200 },
    ReturnValues: "UPDATED_NEW",
  }));
  if (Number(counter.Attributes?.count ?? 0) > RATE_LIMIT_PER_HOUR) {
    return respond(event, 429, { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } });
  }

  // The caller's own profile and the projects they work on (server-side, by the token's email).
  const [member] = await scan<Record<string, unknown>>({ TableName: process.env.TABLE_TEAMMEMBER!, FilterExpression: "email = :e", ExpressionAttributeValues: { ":e": identity.email } });
  if (!member) return respond(event, 404, { error: { code: "NO_PROFILE", message: "Create your team profile first." } });
  const tasks = await scan<{ projectId: string }>({ TableName: process.env.TABLE_TASK!, FilterExpression: "assigneeId = :a", ExpressionAttributeValues: { ":a": member.id }, ProjectionExpression: "projectId" });
  const projectIds = [...new Set(tasks.map((t) => t.projectId))].slice(0, 20);
  const projects = (await Promise.all(projectIds.map((id) => db.send(new GetCommand({ TableName: process.env.TABLE_PROJECT!, Key: { id } })))))
    .map((r) => r.Item)
    .filter((p): p is Record<string, unknown> => !!p && p.organisationId === member.organisationId)
    .map((p) => String(p.name));

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const profile: CareerProfile = {
    name: String(member.name ?? ""),
    jobTitle: str(member.jobTitle),
    skills: Array.isArray(member.skills) ? (member.skills as unknown[]).filter((s): s is string => typeof s === "string" && !!s.trim()) : [],
    professionalSummary: str(member.professionalSummary),
    experience: str(member.experience),
    education: str(member.education),
    projects,
  };
  const basedOn = { jobTitle: !!profile.jobTitle, skills: profile.skills.length, experience: !!profile.experience, education: !!profile.education, summary: !!profile.professionalSummary, projects: projects.length };
  if (isProfileTooThin(profile)) return respond(event, 200, { status: "INCOMPLETE", basedOn });

  try {
    const result = await bedrock.send(new ConverseCommand({
      modelId: process.env.MODEL_ID!,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: [{ text: profilePrompt(profile) }] }],
      inferenceConfig: { maxTokens: 1500, temperature: 0.3 },
      guardrailConfig: { guardrailIdentifier: process.env.GUARDRAIL_ID!, guardrailVersion: process.env.GUARDRAIL_VERSION! },
    }));
    if (result.stopReason === "guardrail_intervened") return respond(event, 422, { error: { code: "BLOCKED", message: "Suggestions couldn't be generated for this profile." } });
    const text = (result.output?.message?.content ?? []).map((c) => c.text ?? "").join("");
    const suggestions = parseSuggestions(text, profile.skills);
    console.info(JSON.stringify({ fn: "career-suggestions", outcome: suggestions ? "OK" : "UNUSABLE", count: suggestions?.length ?? 0, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens }));
    if (!suggestions) return respond(event, 502, { error: { code: "UNUSABLE_ANSWER", message: "The suggestions couldn't be generated. Try again." } });
    return respond(event, 200, { status: "OK", generatedAt: now.toISOString(), model: process.env.MODEL_ID, basedOn, suggestions });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ fn: "career-suggestions", error: name, message: error instanceof Error ? error.message : String(error) }));
    return respond(event, name === "ThrottlingException" ? 503 : 502, { error: { code: "AI_ERROR", message: name === "AccessDeniedException" ? "The AI model isn't enabled for this account yet." : "The suggestions couldn't be generated. Try again." } });
  }
};
