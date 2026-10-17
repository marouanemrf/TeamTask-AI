import { randomUUID } from "node:crypto";
import { route, statusForError } from "./routes";

/**
 * REST task API (API Gateway, Cognito authorizer): create, list, read, update, assign, change status
 * and close tasks. Each call is forwarded to the data API with the caller's own token, so the
 * task functions apply exactly the same rules as in the app. For integrations (scripts, Teams/Jira
 * connectors); the web app itself uses the data API directly (real-time updates).
 */
interface ApiEvent {
  httpMethod: string;
  resource: string;
  pathParameters?: Record<string, string | undefined> | null;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
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

const header = (event: ApiEvent, name: string) => Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];

export const handler = async (event: ApiEvent) => {
  const token = header(event, "authorization");
  if (!token) return respond(event, 401, { error: { code: "UNAUTHORIZED", message: "Sign in again." } });

  let body: Record<string, unknown> = {};
  if (event.body) {
    try {
      const parsed = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(event, 400, { error: { code: "VALIDATION", message: "The body must be a JSON object." } });
    }
  }

  const r = route(event.httpMethod, event.resource, event.pathParameters ?? {}, body, header(event, "idempotency-key"), randomUUID);
  if (!r.ok) return respond(event, r.status, { error: { code: r.status === 404 ? "NOT_FOUND" : "VALIDATION", message: r.message } });

  const response = await fetch(process.env.GRAPHQL_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query: r.call.query, variables: r.call.variables }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (result.errors?.length) {
    const message = result.errors[0].message;
    const status = statusForError(message);
    if (status === 502) console.error(JSON.stringify({ fn: "task-rest", route: `${event.httpMethod} ${event.resource}`, error: message }));
    return respond(event, status, { error: { code: /^\[([A-Z_]+)\]/.exec(message)?.[1] ?? (status === 403 ? "FORBIDDEN" : "INTERNAL"), message: message.replace(/^\[[A-Z_]+\]\s*/, "") } });
  }
  const data = result.data?.[r.call.field];
  if (data === null || data === undefined) return respond(event, 404, { error: { code: "NOT_FOUND", message: "Not found or not readable with your role." } });
  const items = (data as { items?: unknown[] }).items;
  return respond(event, r.call.status, items ? { items } : data);
};
