import { describe, expect, it } from "vitest";
import { route, statusForError } from "./routes";

const id = () => "11111111-1111-4111-8111-111111111111";

describe("REST task API routing", () => {
  it("maps each route to the task mutation or query, keeping only known fields", () => {
    const r = route("POST", "/tasks", {}, { projectId: "p1", title: "IAM review", assigneeId: "m1", role: "ADMIN", organisationId: "other" }, undefined, id);
    expect(r.ok && r.call.field).toBe("addTask");
    expect(r.ok && r.call.status).toBe(201);
    expect(r.ok && r.call.variables).toEqual({ clientRequestId: id(), projectId: "p1", title: "IAM review", assigneeId: "m1" });

    const s = route("POST", "/tasks/{taskId}/status", { taskId: "t1" }, { status: "BLOCKED", reason: "Waiting for access" }, undefined, id);
    expect(s.ok && s.call.field).toBe("changeTaskStatus");
    expect(s.ok && s.call.variables).toMatchObject({ taskId: "t1", status: "BLOCKED", reason: "Waiting for access" });

    expect(route("POST", "/tasks/{taskId}/close", { taskId: "t1" }, {}, undefined, id)).toMatchObject({ ok: true, call: { field: "cancelTask" } });
    expect(route("GET", "/projects/{projectId}/tasks", { projectId: "p1" }, {}, undefined, id)).toMatchObject({ ok: true, call: { field: "listTasks" } });
  });

  it("uses the Idempotency-Key as the request id and rejects a malformed one", () => {
    const key = "22222222-2222-4222-8222-222222222222";
    const r = route("PATCH", "/tasks/{taskId}", { taskId: "t1" }, { title: "x" }, key, id);
    expect(r.ok && r.call.variables.clientRequestId).toBe(key);
    expect(route("PATCH", "/tasks/{taskId}", { taskId: "t1" }, {}, "not-a-uuid", id)).toEqual({ ok: false, status: 400, message: "Idempotency-Key must be a UUID." });
  });

  it("rejects bad ids and unknown routes", () => {
    expect(route("GET", "/tasks/{taskId}", { taskId: "../x" }, {}, undefined, id)).toMatchObject({ ok: false, status: 400 });
    expect(route("DELETE", "/tasks/{taskId}", { taskId: "t1" }, {}, undefined, id)).toMatchObject({ ok: false, status: 404 });
  });

  it("turns task API errors into HTTP statuses", () => {
    expect(statusForError("[FORBIDDEN] Only managers")).toBe(403);
    expect(statusForError("[NOT_FOUND] gone")).toBe(404);
    expect(statusForError("[VALIDATION] bad")).toBe(400);
    expect(statusForError("Not Authorized to access getTask on type Query")).toBe(403);
    expect(statusForError("[INTERNAL] oops")).toBe(502);
  });
});
