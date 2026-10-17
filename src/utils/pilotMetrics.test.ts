import { describe, expect, it } from "vitest";
import { computePilotMetrics } from "./pilotMetrics";

describe("pilot metrics", () => {
  it("measures plans, assignment quality, reminders, overdue work and estimated time saved", () => {
    const m = computePilotMetrics({
      today: "2026-10-17",
      since: "2026-10-01",
      minutesPerTask: 10,
      minutesPerReport: 30,
      tasks: [
        { id: "a", status: "TODO", dueDate: "2026-10-10", createdBy: "AI", createdAt: "2026-10-05" },
        { id: "b", status: "DONE", dueDate: "2026-10-10", createdBy: "AI", createdAt: "2026-10-05" },
        { id: "c", status: "IN_PROGRESS", dueDate: "2026-10-30", createdBy: "HUMAN", createdAt: "2026-10-05" },
        { id: "old", status: "TODO", createdBy: "AI", createdAt: "2026-09-01" },
      ],
      events: [
        { entityId: "a", eventType: "ASSIGNED", createdAt: "2026-10-06T10:00:00Z" },
        { entityId: "c", eventType: "STATUS_CHANGED", createdAt: "2026-10-08T12:00:00Z" },
      ],
      reminders: [
        { taskId: "c", status: "SENT", sentAt: "2026-10-08T07:00:00Z" },
        { taskId: "a", status: "SENT", sentAt: "2026-10-09T07:00:00Z" },
        { taskId: "a", status: "FAILED" },
      ],
      plans: [
        { status: "APPLIED", createdAt: "2026-10-05T08:00:00Z", decidedAt: "2026-10-05T10:00:00Z", tasks: [], approvedTasks: [{ assigneeSource: "AI" }, { assigneeSource: "RULES" }, { assigneeSource: "MANAGER" }, { assigneeSource: "AI" }] },
        { status: "REJECTED", createdAt: "2026-10-06T08:00:00Z", decidedAt: "2026-10-06T14:00:00Z", tasks: [] },
        { status: "PENDING", createdAt: "2026-10-07T08:00:00Z", tasks: [] },
      ],
      reports: [
        { year: 2026, weekNumber: 41, overdueCount: 3, aiGenerated: true },
        { year: 2026, weekNumber: 42, overdueCount: 1, aiGenerated: false },
      ],
    });
    expect(m.plans).toEqual({ requested: 3, approved: 1, rejected: 1, expiredOrFailed: 0, pending: 1, medianDecisionHours: 6 });
    expect(m.assignment).toEqual({ ownersKeptAtApproval: 75, aiTasksNeverReassigned: 50, aiTasks: 2 });
    expect(m.reminders).toEqual({ sent: 2, failed: 1, followedByProgress: 50 });
    expect(m.overdue).toMatchObject({ open: 3, overdue: 1, overduePercent: 33 });
    expect(m.overdue.trend).toEqual([{ week: "2026-W41", overdue: 3 }, { week: "2026-W42", overdue: 1 }]);
    expect(m.timeSaved).toEqual({ aiTasks: 2, aiReports: 1, minutes: 50 });
  });

  it("returns no percentage when there is nothing to measure", () => {
    const m = computePilotMetrics({ today: "2026-10-17", since: "2026-10-01", minutesPerTask: 10, minutesPerReport: 30, tasks: [], events: [], reminders: [], plans: [], reports: [] });
    expect(m.assignment.ownersKeptAtApproval).toBeNull();
    expect(m.reminders.followedByProgress).toBeNull();
    expect(m.overdue.overduePercent).toBeNull();
  });
});
