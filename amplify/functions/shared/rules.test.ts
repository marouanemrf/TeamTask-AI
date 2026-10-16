import { describe, expect, it } from "vitest";
import {
  canBeAssigned,
  canPerform,
  checkStatusChange,
  descendantIds,
  dueDateWarning,
  isOverdue,
  toRoles,
  unfinishedDependencies,
  validateBlockReason,
  wouldCreateCycle,
} from "./rules";
import type { DependencyLike, Role, TaskAction, TaskLike } from "./rules";

const task = (id: string, status: TaskLike["status"] = "TODO", extra: Partial<TaskLike> = {}): TaskLike => ({ id, title: `Task ${id}`, status, ...extra });
const byId = (...tasks: TaskLike[]) => new Map(tasks.map((t) => [t.id, t]));
const dep = (fromTaskId: string, toTaskId: string): DependencyLike => ({ fromTaskId, toTaskId });

describe("dependency check (checkStatusChange)", () => {
  const report = task("report");
  const a = task("a", "DONE");
  const b = task("b", "IN_PROGRESS");
  const c = task("c", "CANCELLED");
  const deps = [dep("report", "a"), dep("report", "b"), dep("report", "c")];

  it("rejects IN_PROGRESS and DONE while a dependency is not done, naming it", () => {
    for (const target of ["IN_PROGRESS", "DONE"] as const) {
      const result = checkStatusChange(report, target, deps, byId(report, a, b, c));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.blocking).toEqual(["b"]);
        expect(result.reason).toContain("“Task b”");
        expect(result.reason).not.toContain("« Task a »");
      }
    }
  });

  it("allows the move once every dependency is DONE (CANCELLED ones no longer block)", () => {
    const result = checkStatusChange(report, "DONE", deps, byId(report, a, { ...b, status: "DONE" }, c));
    expect(result.ok).toBe(true);
  });

  it("never gates TODO, BLOCKED or PROPOSED", () => {
    for (const target of ["TODO", "BLOCKED", "PROPOSED"] as const) {
      expect(checkStatusChange(report, target, deps, byId(report, a, b, c)).ok).toBe(true);
    }
  });

  it("lists several blocking tasks", () => {
    const result = checkStatusChange(report, "DONE", [dep("report", "b"), dep("report", "x")], byId(report, b, task("x")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("“Task b” and “Task x”");
  });

  it("unfinishedDependencies ignores unknown task ids", () => {
    expect(unfinishedDependencies("report", [dep("report", "ghost")], byId(report))).toEqual([]);
  });
});

describe("circular dependency check (wouldCreateCycle)", () => {
  // c depends on b, b depends on a
  const deps = [dep("c", "b"), dep("b", "a")];

  it("rejects a self dependency", () => {
    expect(wouldCreateCycle("a", ["a"], [])).toBe(true);
  });

  it("rejects a direct cycle", () => {
    expect(wouldCreateCycle("b", ["c"], deps)).toBe(true);
  });

  it("rejects a transitive cycle", () => {
    expect(wouldCreateCycle("a", ["c"], deps)).toBe(true);
  });

  it("accepts independent or downstream links", () => {
    expect(wouldCreateCycle("c", ["a"], deps)).toBe(false);
    expect(wouldCreateCycle("d", ["a", "b", "c"], deps)).toBe(false);
  });

  it("ignores the task's current dependencies (they are being replaced)", () => {
    // b currently depends on a; replacing b's deps with [a] is fine
    expect(wouldCreateCycle("b", ["a"], deps)).toBe(false);
  });

  it("descendantIds walks the whole subtask tree", () => {
    const tasks = [task("p"), task("c1", "TODO", { parentTaskId: "p" }), task("c2", "TODO", { parentTaskId: "c1" }), task("x")];
    expect([...descendantIds("p", tasks)].sort()).toEqual(["c1", "c2"]);
  });
});

describe("permission matrix (canPerform)", () => {
  const actions: TaskAction[] = ["create", "update", "assign", "cancel", "changeStatus"];
  const matrix: Record<Role, Record<TaskAction, [own: boolean, other: boolean]>> = {
    ADMIN: { create: [true, true], update: [true, true], assign: [true, true], cancel: [true, true], changeStatus: [true, true] },
    PROJECT_MANAGER: { create: [true, true], update: [true, true], assign: [true, true], cancel: [true, true], changeStatus: [true, true] },
    MEMBER: { create: [false, false], update: [false, false], assign: [false, false], cancel: [false, false], changeStatus: [true, false] },
    VIEWER: { create: [false, false], update: [false, false], assign: [false, false], cancel: [false, false], changeStatus: [false, false] },
  };

  for (const role of Object.keys(matrix) as Role[]) {
    for (const action of actions) {
      const [own, other] = matrix[role][action];
      it(`${role} ${action}: own task ${own ? "allowed" : "denied"}, other's ${other ? "allowed" : "denied"}`, () => {
        expect(canPerform(action, [role], { isAssignee: true })).toBe(own);
        expect(canPerform(action, [role], { isAssignee: false })).toBe(other);
      });
    }
  }

  it("no group means VIEWER", () => {
    expect(toRoles([])).toEqual(["VIEWER"]);
    expect(toRoles(undefined)).toEqual(["VIEWER"]);
    expect(toRoles(["SomethingElse"])).toEqual(["VIEWER"]);
    expect(canPerform("changeStatus", toRoles([]), { isAssignee: true })).toBe(false);
  });

  it("combines permissions across multiple assigned roles", () => {
    expect(canPerform("changeStatus", toRoles(["MEMBER", "VIEWER"]), { isAssignee: true })).toBe(true);
    expect(canPerform("create", toRoles(["ADMIN", "VIEWER"]))).toBe(true);
  });

  it("the most privileged group wins", () => {
    expect(canPerform("create", toRoles(["MEMBER", "PROJECT_MANAGER"]))).toBe(true);
  });
});

describe("other rules", () => {
  it("blocker reason needs 10 to 500 characters", () => {
    expect(validateBlockReason("too short")).toBeDefined();
    expect(validateBlockReason("   padded   ")).toBeDefined();
    expect(validateBlockReason("Waiting for client access")).toBeUndefined();
    expect(validateBlockReason("x".repeat(501))).toBeDefined();
  });

  it("due date outside the project only warns", () => {
    expect(dueDateWarning("2026-01-01", "2026-02-01", "2026-03-01")).toContain("before the project starts");
    expect(dueDateWarning("2026-04-01", "2026-02-01", "2026-03-01")).toContain("after the project ends");
    expect(dueDateWarning("2026-02-15", "2026-02-01", "2026-03-01")).toBeUndefined();
  });

  it("overdue = past due and still open", () => {
    expect(isOverdue({ status: "TODO", dueDate: "2026-01-01" }, "2026-01-02")).toBe(true);
    expect(isOverdue({ status: "DONE", dueDate: "2026-01-01" }, "2026-01-02")).toBe(false);
    expect(isOverdue({ status: "TODO", dueDate: "2026-01-02" }, "2026-01-02")).toBe(false);
  });
});

describe("canBeAssigned", () => {
  it("accepts members who can work on tasks", () => {
    expect(canBeAssigned({ role: "MEMBER" })).toBe(true);
    expect(canBeAssigned({ role: "VIEWER", roles: ["VIEWER", "PROJECT_MANAGER"] })).toBe(true);
  });
  it("rejects read-only or role-less members", () => {
    expect(canBeAssigned({ role: "VIEWER", roles: ["VIEWER"] })).toBe(false);
    expect(canBeAssigned({ role: null, roles: [] })).toBe(false);
  });
});
