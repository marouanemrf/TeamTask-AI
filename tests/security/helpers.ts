/**
 * Shared helpers for the live security tests (proposal step 7). They call the deployed sandbox
 * with real Cognito tokens, so they only run when the fixtures exist and a password is set:
 *   SEC_TEST_PASSWORD='…' npx tsx scripts/security/setup-test-users.ts
 *   SEC_TEST_PASSWORD='…' npm run test:security
 * Every case is appended to tests/security/.results.jsonl (request, expected, actual, pass).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";

export type UserKey = "A_ADMIN" | "A_PM" | "A_MEMBER" | "A_VIEWER" | "B_PM";
export const ROLE_KEYS: readonly UserKey[] = ["A_ADMIN", "A_PM", "A_MEMBER", "A_VIEWER"];

export interface Fixtures {
  region: string;
  userPoolId: string;
  identityPoolId: string;
  bucket: string;
  apiUrl: string;
  /** API Gateway base URL (assistant), null if not deployed. */
  restApiUrl: string | null;
  clientId: string;
  orgAId: string;
  orgBId: string;
  users: Record<UserKey, { email: string; role: string; org: string; memberId: string; sub: string }>;
  projects: Record<"A" | "B", { id: string; organisationId: string; name: string }>;
  tasks: Record<"A" | "B", { id: string; projectId: string; title: string; assigneeId: string }>;
}

const FIXTURES = new URL("./.fixtures.json", import.meta.url);
const RESULTS = new URL("./.results.jsonl", import.meta.url);

export const enabled = existsSync(FIXTURES) && !!(process.env.SEC_TEST_PASSWORD || process.env.SEC_PASSWORD_A_ADMIN);
export const fx: Fixtures = enabled ? JSON.parse(readFileSync(FIXTURES, "utf8")) : ({} as Fixtures);

/* ------------------------------- tokens -------------------------------- */

const tokens = new Map<UserKey, string>();
export async function idToken(key: UserKey): Promise<string> {
  const cached = tokens.get(key);
  if (cached) return cached;
  const password = process.env[`SEC_PASSWORD_${key}`] ?? process.env.SEC_TEST_PASSWORD;
  const cognito = new CognitoIdentityProviderClient({ region: fx.region });
  const result = await cognito.send(new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: fx.clientId,
    AuthParameters: { USERNAME: fx.users[key].email, PASSWORD: password! },
  }));
  const token = result.AuthenticationResult?.IdToken;
  if (!token) throw new Error(`No token for ${key} (challenge: ${result.ChallengeName ?? "none"})`);
  tokens.set(key, token);
  return token;
}

/* ------------------------------- GraphQL ------------------------------- */

export interface GqlResult {
  status: number;
  data: Record<string, unknown> | null;
  errors: { message: string; errorType?: string }[];
}

/** Calls AppSync. `token` null = no Authorization header. */
export async function gql(token: string | null, query: string, variables: Record<string, unknown> = {}): Promise<GqlResult> {
  const response = await fetch(fx.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  let body: { data?: Record<string, unknown> | null; errors?: { message: string; errorType?: string }[] } = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error page */
  }
  return { status: response.status, data: body.data ?? null, errors: body.errors ?? [] };
}

export const as = async (key: UserKey, query: string, variables?: Record<string, unknown>) => gql(await idToken(key), query, variables);

/** Denied by AppSync auth (401/Unauthorized) or by a function rule ([FORBIDDEN]). */
export function isDenied(r: GqlResult): boolean {
  return r.status === 401 || r.status === 403 || r.errors.some((e) => /Unauthorized|Not Authorized|\[FORBIDDEN\]|UnauthorizedException/i.test(`${e.errorType} ${e.message}`));
}
/** Not found or denied: what a cross-tenant request may return. */
export function isDeniedOrHidden(r: GqlResult, field: string): boolean {
  return isDenied(r) || r.errors.some((e) => /\[NOT_FOUND\]/.test(e.message)) || (r.errors.length === 0 && r.data?.[field] == null);
}
export const ok = (r: GqlResult, field: string) => r.status === 200 && r.errors.length === 0 && r.data?.[field] != null;
export const summary = (r: GqlResult) => `HTTP ${r.status}${r.errors.length ? ` · ${r.errors.map((e) => `${e.errorType ?? ""} ${e.message}`.trim()).join(" | ").slice(0, 220)}` : " · ok"}`;

/* ------------------------------ recording ------------------------------ */

export interface CaseResult {
  category: string;
  name: string;
  request: string;
  expected: string;
  actual: string;
  pass: boolean;
  /** Not applicable on the deployed stack (component missing): reported as N/A, not as a pass. */
  na?: boolean;
}

/** Records one case for the report, then returns `pass` so the test can assert on it. */
export function record(result: CaseResult): boolean {
  appendFileSync(RESULTS, JSON.stringify({ ...result, at: new Date().toISOString() }) + "\n");
  return result.pass;
}

/* -------------------------------- misc --------------------------------- */

export const uuid = () => crypto.randomUUID();

/** Runs the AWS CLI and returns stdout (JSON output). Used for IAM, logs and Lambda checks. */
export function aws(args: string[]): string {
  return execFileSync("aws", [...args, "--region", fx.region, "--output", "json"], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}
