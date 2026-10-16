import { describe, expect, it } from "vitest";
import { suggestCareers } from "./careerSuggestions";

describe("suggestCareers", () => {
  it("returns nothing without profile data (no invented suggestions)", () => {
    expect(suggestCareers({ skills: [] })).toEqual([]);
  });

  it("ranks paths matching skills and title first, with matched skills and gaps", () => {
    const [top] = suggestCareers({ skills: ["AWS security", "IAM"], jobTitle: "Cloud Engineer" });
    expect(top.title).toBe("Cloud Security Engineer");
    expect(top.matchedSkills).toEqual(["AWS security", "IAM"]);
    expect(top.skillGaps).toEqual(["Infrastructure as Code", "Kubernetes security"]);
    expect(top.reasons.join(" ")).toMatch(/skills .*job title/);
  });

  it("uses experience, education and projects text", () => {
    const result = suggestCareers({ skills: [], experience: "Led ISO 27001 audit and risk assessment for a bank" });
    expect(result[0].title).toBe("GRC / Compliance Consultant");
    expect(result[0].reasons[0]).toMatch(/experience, education or projects/);
  });

  it("returns at most the requested number of suggestions", () => {
    const result = suggestCareers(
      { skills: ["Pentest", "ISO 27001", "Incident response", "AWS security", "Project management"] },
      2,
    );
    expect(result).toHaveLength(2);
  });
});
