import { describe, expect, it } from "vitest";
import type { Task } from "../services/client";
import { activeEscalations } from "./escalations";
import { computeWorkload, summariseWorkload } from "./workload";

const task = (fields: Partial<Task>) => ({ id: "t", projectId: "p", title: "T", status: "TODO", ...fields }) as Task;

describe("summariseWorkload", () => {
  it("counts open, overdue, blocked, unassigned and unestimated tasks from real task data", () => {
    const tasks = [
      task({ id: "a", status: "IN_PROGRESS", dueDate: "2026-10-01", estimatedHours: 10, assigneeId: "m1" }),
      task({ id: "b", status: "BLOCKED", dueDate: "2026-12-01", assigneeId: "m1" }),
      task({ id: "c", status: "TODO", assigneeId: null }),
      task({ id: "d", status: "DONE", dueDate: "2026-01-01", estimatedHours: 50, assigneeId: "m2" }),
      task({ id: "e", status: "CANCELLED", dueDate: "2026-01-01", assigneeId: "m2" }),
    ];
    const rows = [
      { workload: computeWorkload(tasks.filter((t) => t.assigneeId === "m1"), 8) },
      { workload: computeWorkload(tasks.filter((t) => t.assigneeId === "m2"), 40) },
      { workload: computeWorkload([], null) },
    ];
    expect(summariseWorkload(rows, tasks, "2026-10-15")).toEqual({
      openTasks: 3, unassigned: 1, overdue: 1, blocked: 1, overloaded: 1, average: 63, withoutEstimate: 2,
    });
  });
});

describe("activeEscalations", () => {
  it("keeps OPEN escalations whose task is still open", () => {
    const tasks = new Map([["open", { status: "IN_PROGRESS" }], ["done", { status: "DONE" }], ["cancelled", { status: "CANCELLED" }]] as const);
    const escalations: { id: string; status: "OPEN" | "RESOLVED"; taskId: string }[] = [
      { id: "1", status: "OPEN", taskId: "open" },
      { id: "2", status: "OPEN", taskId: "done" },
      { id: "3", status: "OPEN", taskId: "cancelled" },
      { id: "4", status: "RESOLVED", taskId: "open" },
      { id: "5", status: "OPEN", taskId: "deleted" },
    ];
    expect(activeEscalations(escalations, tasks as never).map((e) => e.id)).toEqual(["1"]);
  });
});
