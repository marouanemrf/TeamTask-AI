import { describe, expect, it } from "vitest";
import { M, Q } from "./documents";
import { enabled, fx, gql, idToken, record, summary, uuid } from "./helpers";

/** Every operation must refuse a request without a valid Cognito token (AppSync answers 401). */
const OPERATIONS: Array<[string, string, () => Record<string, unknown>]> = [
  ["listProjects", Q.listProjects, () => ({})],
  ["getTask", Q.getTask, () => ({ id: fx.tasks.A.id })],
  ["listTeamMembers", Q.listTeamMembers, () => ({})],
  ["listTaskEvents", Q.listTaskEvents, () => ({})],
  ["createProject", M.createProject, () => ({ input: { organisationId: fx.orgAId, name: "x" } })],
  ["addTask", M.addTask, () => ({ clientRequestId: uuid(), projectId: fx.projects.A.id, title: "x", assigneeId: fx.users.A_MEMBER.memberId })],
  ["changeTaskStatus", M.changeTaskStatus, () => ({ clientRequestId: uuid(), taskId: fx.tasks.A.id, status: "IN_PROGRESS" })],
  ["assignTask", M.assignTask, () => ({ clientRequestId: uuid(), taskId: fx.tasks.A.id, assigneeId: fx.users.A_MEMBER.memberId })],
  ["cancelTask", M.cancelTask, () => ({ clientRequestId: uuid(), taskId: fx.tasks.A.id })],
  ["manageTeamMember", M.manageTeamMember, () => ({ action: "DELETE", memberId: fx.users.A_VIEWER.memberId })],
  ["generateWeeklyReport", M.generateWeeklyReport, () => ({ projectId: fx.projects.A.id })],
  ["heartbeatPresence", M.heartbeatPresence, () => ({ status: "ONLINE" })],
];

/** Same header and payload, signature replaced: must fail signature verification. */
function tamper(token: string): string {
  const [h, p] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload["cognito:groups"] = ["ADMIN"];
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${"A".repeat(43)}`;
}
/** Real header, payload with an expiry in the past, original signature (no longer matches). */
function expire(token: string): string {
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload.exp = Math.floor(Date.now() / 1000) - 3600;
  payload.iat = payload.exp - 3600;
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

describe.skipIf(!enabled)("a. authentication", () => {
  for (const [name, doc, vars] of OPERATIONS) {
    for (const variant of ["no token", "expired token", "tampered token"] as const) {
      it(`${name}: ${variant} → 401`, async () => {
        const real = await idToken("A_VIEWER");
        const token = variant === "no token" ? null : variant === "expired token" ? expire(real) : tamper(real);
        const r = await gql(token, doc, vars());
        const pass = r.status === 401 && r.data == null;
        record({ category: "a. Authentication", name: `${name} – ${variant}`, request: `POST ${name} (${variant})`, expected: "401, no data", actual: summary(r), pass });
        expect(pass).toBe(true);
      });
    }
  }
});
