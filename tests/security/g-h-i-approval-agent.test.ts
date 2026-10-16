import { describe, expect, it } from "vitest";
import { M } from "./documents";
import { as, enabled, fx, isDenied, record, summary, uuid } from "./helpers";

/**
 * g. Approval bypass. The deployed stack has no Step Functions approval workflow yet (planned in
 * phase 3): the approval-related surface is the AIRecommendation / Approval models and the
 * escalation decision. A MEMBER or VIEWER must not approve anything, and nobody may write an
 * Approval directly (approvals must come from the workflow).
 */
describe.skipIf(!enabled)("g. approval bypass (current stack)", () => {
  for (const key of ["A_MEMBER", "A_VIEWER"] as const) {
    it(`${key} cannot resolve an escalation`, async () => {
      const r = await as(key, M.resolveEscalation, { clientRequestId: uuid(), escalationId: "sec-any", decision: "ACCEPT_DELAY" });
      const pass = isDenied(r);
      record({ category: "g. Approval bypass", name: `resolveEscalation as ${key}`, request: `resolveEscalation as ${key}`, expected: "denied", actual: summary(r), pass });
      expect(pass).toBe(true);
    });
    it(`${key} cannot write a recommendation or an approval`, async () => {
      const rec = await as(key, M.createAIRecommendation, { input: { projectId: fx.projects.A.id, type: "PLAN", status: "APPROVED" } });
      const appr = await as(key, M.createApproval, { input: { recommendationId: "sec-any", decision: "APPROVED", decidedBy: fx.users[key].email } });
      const pass = isDenied(rec) && isDenied(appr);
      record({ category: "g. Approval bypass", name: `recommendation/approval writes as ${key}`, request: `createAIRecommendation + createApproval as ${key}`, expected: "denied", actual: `${summary(rec)} / ${summary(appr)}`, pass });
      expect(pass).toBe(true);
    });
  }

  for (const key of ["A_ADMIN", "A_PM"] as const) {
    it(`${key} cannot record an approval or mark a recommendation APPROVED outside the workflow`, async () => {
      const rec = await as(key, M.createAIRecommendation, { input: { projectId: fx.projects.A.id, type: "PLAN", status: "APPROVED" } });
      const appr = await as(key, M.createApproval, { input: { recommendationId: "sec-any", decision: "APPROVED", decidedBy: fx.users[key].email } });
      const pass = isDenied(rec) && isDenied(appr);
      record({ category: "g. Approval bypass", name: `direct approval as ${key}`, request: `createAIRecommendation(status APPROVED) + createApproval as ${key}`, expected: "denied (approvals only through the approval workflow)", actual: `${summary(rec)} / ${summary(appr)}`, pass });
      expect(pass).toBe(true);
    });
  }
});

/** h & i need the Bedrock agent (phase 4), which is not deployed: recorded as not applicable. */
describe.skipIf(!enabled)("h/i. agent tests", () => {
  it("not applicable on this stack", () => {
    for (const [category, name] of [
      ["h. Prompt injection", "agent plan with injected instructions in tasks, objectives and attachment names"],
      ["i. Unintended actions", "agent tools read-only except submitRecommendation (IAM + action group schema)"],
    ]) {
      record({ category, name, request: "—", expected: "run against the Bedrock agent", actual: "NOT RUN: no Bedrock agent, action groups or agent API exist in the deployed stack (phase 4)", pass: true, na: true });
    }
    expect(true).toBe(true);
  });
});
