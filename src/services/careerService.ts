import { authorizedFetch } from "./restApi";

/** One AI-generated career path (the server keeps "skills you have" to skills really in the profile). */
export interface CareerSuggestion {
  title: string;
  why: string[];
  skillsYouHave: string[];
  skillsToDevelop: string[];
  nextSteps: string[];
  /** Open projects of the organisation that need this path now; empty = no current need. */
  projects?: string[];
}

export interface CareerSuggestionsResult {
  status: "OK" | "INCOMPLETE";
  generatedAt?: string;
  model?: string;
  /** What the suggestions were based on (counts and flags, no content). */
  basedOn: { jobTitle: boolean; skills: number; experience: boolean; education: boolean; summary: boolean; projects: number };
  suggestions?: CareerSuggestion[];
}

/**
 * AI career suggestions from a member's profile (read on the server): the user's own, or, for
 * administrators and project managers, another member of their organisation.
 */
export async function fetchCareerSuggestions(memberId: string, signal?: AbortSignal): Promise<CareerSuggestionsResult> {
  const response = await authorizedFetch("/profile/career-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId }), signal });
  return (await response.json()) as CareerSuggestionsResult;
}
