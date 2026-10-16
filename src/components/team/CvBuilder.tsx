import { useId } from "react";
import type { CareerState } from "../../hooks/useCareerSuggestions";
import type { Project, TeamMember } from "../../services/client";
import CareerSuggestions from "./CareerSuggestions";

export interface CvBuilderProps {
  member: TeamMember;
  email: string | null;
  /** Projects the member worked on (has tasks in). */
  projects: readonly Project[];
  /** AI career suggestions from the same profile (shown in the CV document, not printed). */
  career: CareerState;
  onRefreshCareer: () => void;
}

/**
 * ATS-friendly CV generated from the saved profile: single column, plain headings, no tables or
 * images. Nothing is typed here — the content always follows the profile. The CV paper also carries
 * the AI career suggestions (not exported). Export uses the browser's "Save as PDF".
 */
function CvBuilder({ member, email, projects, career, onRefreshCareer }: CvBuilderProps) {
  const id = useId();
  const skills = (member.skills ?? []).filter((s): s is string => !!s);
  const headline = member.jobTitle || "";
  const summary = member.professionalSummary ?? "";
  const lines = (text: string | null | undefined) => (text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const experience = lines(member.experience);
  const education = lines(member.education);

  return (
    <>
      <section className="panel" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="panel__title">CV builder</h2>
        <p className="form-hint">
          Generated automatically from your saved profile — update the profile above to change it, then export it with
          your browser's “Save as PDF”.
        </p>
        <div className="cv-builder__actions">
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
            <CareerSuggestions state={career} onRefresh={onRefreshCareer} />
          </aside>
        </article>
      </section>
    </>
  );
}

export default CvBuilder;
