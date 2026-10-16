import type { CareerSuggestion } from "../../utils/careerSuggestions";

export interface CareerSuggestionsProps {
  suggestions: readonly CareerSuggestion[];
  /** Title of the path the CV is tailored to, if any. */
  selected: string | null;
  onSelect: (title: string) => void;
}

/**
 * Rule-based career paths from the user's profile, shown inside the CV document — clearly labelled
 * as not being job openings. Choosing one tailors the CV to that path.
 */
function CareerSuggestions({ suggestions, selected, onSelect }: CareerSuggestionsProps) {
  return (
    <section aria-labelledby="career-title">
      <h2 id="career-title">Career suggestions</h2>
      <p className="form-hint">
        Automatically generated from your skills, job title, experience, education and projects, using a fixed set of
        career paths. These are general suggestions, <strong>not job openings</strong>, and no external job data is used.
      </p>
      {suggestions.length === 0 ? (
        <p className="empty-state">Add skills, a job title or experience to your profile to get suggestions.</p>
      ) : (
        <div className="suggestion-grid">
          {suggestions.map((s) => {
            const active = s.title === selected;
            return (
              <article className={`suggestion-card${active ? " suggestion-card--active" : ""}`} key={s.title}>
                <h4>{s.title}</h4>
                <p className="text-muted">{s.path}</p>
                <dl className="suggestion-card__facts">
                  <dt>Why</dt>
                  <dd>Matches your {s.reasons.join("; ")}.</dd>
                  <dt>Industries</dt>
                  <dd>{s.industries.join(", ")}</dd>
                  <dt>Markets</dt>
                  <dd>{s.markets.join(", ")}</dd>
                  <dt>Skills you have</dt>
                  <dd>{s.matchedSkills.join(", ") || "None of the core skills yet"}</dd>
                  <dt>Skills to develop</dt>
                  <dd>{s.skillGaps.join(", ") || "You list all the core skills"}</dd>
                </dl>
                <button type="button" className="button-secondary" aria-pressed={active} onClick={() => onSelect(s.title)}>
                  {active ? "CV tailored to this path" : "Tailor CV to this path"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default CareerSuggestions;
