import { useId, useMemo, useState } from "react";
import type { Project, TeamMember } from "../../services/client";
import type { CareerSuggestion } from "../../utils/careerSuggestions";
import CareerSuggestions from "./CareerSuggestions";

export interface CvBuilderProps {
  member: TeamMember;
  email: string | null;
  /** Projects the member worked on (has tasks in). */
  projects: readonly Project[];
  /** Rule-based career paths from the same profile; picking one tailors the CV to it. */
  suggestions: readonly CareerSuggestion[];
}

/**
 * ATS-friendly CV generated from the saved profile: single column, plain headings, no tables or
 * images. Nothing is typed here — the content always follows the profile. The CV builder card only
 * holds the actions; the CV paper below it carries the career suggestions (not exported), and
 * picking one tailors the headline and skill order. Export uses the browser's "Save as PDF".
 */
function CvBuilder({ member, email, projects, suggestions }: CvBuilderProps) {
  const id = useId();
  const [targetTitle, setTargetTitle] = useState<string | null>(null);
  const target = suggestions.find((s) => s.title === targetTitle) ?? null;

  // Skills the chosen career path relies on come first.
  const skills = useMemo(() => {
    const list = (member.skills ?? []).filter((s): s is string => !!s);
    const focus = new Set((target?.matchedSkills ?? []).map((s) => s.toLowerCase()));
    return [...list.filter((s) => focus.has(s.toLowerCase())), ...list.filter((s) => !focus.has(s.toLowerCase()))];
  }, [member.skills, target]);

  const headline = target?.title || member.jobTitle || "";
  const summary = member.professionalSummary ?? "";
  const lines = (text: string | null | undefined) => (text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const experience = lines(member.experience);
  const education = lines(member.education);

  return (
    <>
      <section className="panel" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="panel__title">CV builder</h2>
        <p className="form-hint">
          Generated automatically from your saved profile — update the profile above to change it. Pick a career
          suggestion in your CV below to tailor it to that path, then export it with your browser's “Save as PDF”.
        </p>
        <div className="cv-builder__actions">
          <button type="button" className="button-secondary" onClick={() => setTargetTitle(null)} disabled={!target}>
            Use my profile title
          </button>
          <button type="button" className="button-primary" onClick={() => window.print()}>
            Export to PDF
          </button>
        </div>
      </section>

      <section className="cv-document" aria-label="My CV">
        <article className="cv-preview" aria-label="CV preview">
          <header>
            <h1>{member.name}</h1>
            {headline && <p className="cv-preview__headline">{headline}</p>}
            <p>{[email, member.phoneNumber].filter(Boolean).join(" · ")}</p>
            {target && <p>Seeking {target.title} roles · {target.industries.slice(0, 2).join(", ")}</p>}
          </header>
          {summary && (
            <section>
              <h2>Profile</h2>
              <p>{summary}</p>
            </section>
          )}
          {skills.length > 0 && (
            <section>
              <h2>Skills</h2>
              <p>{skills.join(" · ")}</p>
            </section>
          )}
          {experience.length > 0 && (
            <section>
              <h2>Experience</h2>
              <ul>{experience.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </section>
          )}
          {education.length > 0 && (
            <section>
              <h2>Education</h2>
              <ul>{education.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </section>
          )}
          {projects.length > 0 && (
            <section>
              <h2>Relevant projects</h2>
              <ul>{projects.map((p) => <li key={p.id}>{p.name}{p.clientName ? ` (${p.clientName})` : ""}{p.objective ? ` — ${p.objective}` : ""}</li>)}</ul>
            </section>
          )}
          {!summary && !skills.length && !experience.length && !education.length && (
            <p className="cv-preview__empty">Add a summary, skills, experience or education to your profile to fill this CV.</p>
          )}
          {/* Part of the CV document on screen, left out of the exported PDF. */}
          <aside className="cv-preview__suggestions">
            <CareerSuggestions suggestions={suggestions} selected={target?.title ?? null} onSelect={setTargetTitle} />
          </aside>
        </article>
      </section>
    </>
  );
}

export default CvBuilder;
