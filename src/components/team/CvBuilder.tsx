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
  /** False when a manager views a member's CV (wording, export label). */
  ownProfile?: boolean;
}

/**
 * ATS-friendly CV generated from the saved profile: single column, plain headings, no tables or
 * images. Nothing is typed here — the content always follows the profile. The CV paper also carries
 * the AI career suggestions (not exported). Export uses the browser's "Save as PDF".
 */
function CvBuilder({ member, email, projects, career, onRefreshCareer, ownProfile = true }: CvBuilderProps) {
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
        <h2 id={`${id}-title`} className="panel__title">{ownProfile ? "CV builder" : `CV of ${member.name}`}</h2>
        <p className="form-hint">
          {ownProfile
            ? "Generated automatically from your saved profile — update the profile above to change it, then export it with your browser's “Save as PDF”."
            : "Generated automatically from the member's saved profile and the projects they work on. Export it with your browser's “Save as PDF”."}
        </p>
        <div className="cv-builder__actions">
          <button type="button" className="button-primary" onClick={() => window.print()}>
            Export to PDF
          </button>
        </div>
      </section>

      <section className="cv-document" aria-label={ownProfile ? "My CV" : `CV of ${member.name}`}>
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
            <p className="cv-preview__empty">{ownProfile ? "Add a summary, skills, experience or education to your profile to fill this CV." : "This member's profile has no summary, skills, experience or education yet."}</p>
          )}
          {/* Part of the CV document on screen, left out of the exported PDF. */}
          <aside className="cv-preview__suggestions">
            <CareerSuggestions state={career} onRefresh={onRefreshCareer} ownProfile={ownProfile} />
          </aside>
        </article>
      </section>
    </>
  );
}

export default CvBuilder;
