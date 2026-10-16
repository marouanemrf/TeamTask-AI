import { authorizedFetch } from "./restApi";

/** One AI-generated career path (the server keeps "skills you have" to skills really in the profile). */
export interface CareerSuggestion {
  title: string;
  why: string[];
  skillsYouHave: string[];
  skillsToDevelop: string[];
  nextSteps: string[];
}

export interface CareerSuggestionsResult {
  status: "OK" | "INCOMPLETE";
  generatedAt?: string;
  model?: string;
  /** What the suggestions were based on (counts and flags, no content). */
  basedOn: { jobTitle: boolean; skills: number; experience: boolean; education: boolean; summary: boolean; projects: number };
  suggestions?: CareerSuggestion[];
}

/** AI career suggestions from the signed-in user's own profile (read on the server). */
export async function fetchCareerSuggestions(signal?: AbortSignal): Promise<CareerSuggestionsResult> {
  const response = await authorizedFetch("/profile/career-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal });
  return (await response.json()) as CareerSuggestionsResult;
}
