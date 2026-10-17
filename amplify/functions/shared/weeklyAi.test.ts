import { describe, expect, it } from "vitest";
import { parseWeeklyAnswer, weeklyPrompt } from "./weeklyAi";
import type { WeeklyFacts } from "./weeklyAi";

const facts: WeeklyFacts = {
  project: "Acme", week: "2026-W42", total: 48, completed: 31, inProgress: 12, overdue: 5, blocked: 1, completionRate: 65,
  risks: ["Overdue: ISO gap analysis (blocks: Consolidated report)."], overloaded: [{ name: "Karim", percent: 130 }], available: [{ name: "Sara", percent: 40 }],
  openTasks: [{ title: "ISO gap analysis", dueDate: "2026-10-10", owner: "Karim", status: "IN_PROGRESS" }],
};

describe("AI weekly report", () => {
  it("keeps an answer that quotes the real completion rate, bounded", () => {
    const answer = JSON.stringify({ summary: "65% of tasks are done. The ISO gap analysis is late and blocks the report.", correctiveActions: ["Move ISO gap analysis from Karim to Sara this week.", "", 3, ...Array(6).fill("x")] });
    const parsed = parseWeeklyAnswer(`Sure:\n${answer}`, facts);
    expect(parsed?.summary).toContain("65%");
    expect(parsed?.correctiveActions).toHaveLength(5);
    expect(parsed?.correctiveActions[0]).toBe("Move ISO gap analysis from Karim to Sara this week.");
  });

  it("rejects an answer with other numbers or no JSON (the rule-based text is used instead)", () => {
    expect(parseWeeklyAnswer(JSON.stringify({ summary: "80% done." }), facts)).toBeNull();
    expect(parseWeeklyAnswer("All good", facts)).toBeNull();
    expect(parseWeeklyAnswer(JSON.stringify({ summary: "" }), facts)).toBeNull();
  });

  it("wraps the facts in <facts> tags", () => {
    expect(weeklyPrompt(facts).startsWith("<facts>")).toBe(true);
  });
});
