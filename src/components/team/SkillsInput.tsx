import { useState } from "react";
import type { KeyboardEvent } from "react";
import SkillChips from "./SkillChips";

const SKILL_SUGGESTIONS = [
  "AWS security",
  "IAM",
  "Vulnerability management",
  "Incident response",
  "ISO 27001",
  "GRC",
  "Pentest",
  "Reporting",
];

export interface SkillsInputProps {
  /** id of the text input (the caller renders the <label htmlFor>). */
  id: string;
  skills: string[];
  onChange: (skills: string[]) => void;
  suggestions?: readonly string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Chips input: type and press Enter (or comma) to add, Backspace on an empty field removes the
 * last chip, click a suggestion to add it. A typed but unconfirmed skill is added on blur.
 */
function SkillsInput({ id, skills, onChange, suggestions = SKILL_SUGGESTIONS }: SkillsInputProps) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const skill = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    setDraft("");
    if (!skill || skills.some((s) => same(s, skill))) return;
    onChange([...skills, skill]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault(); // Enter adds a chip instead of submitting the form
      add(draft);
    } else if (event.key === "Backspace" && !draft && skills.length > 0) {
      onChange(skills.slice(0, -1));
    }
  }

  const remaining = suggestions.filter((s) => !skills.some((k) => same(k, s)));

  return (
    <>
      <SkillChips
        skills={skills}
        onRemove={(s) => onChange(skills.filter((x) => x !== s))}
        emptyLabel="No skills yet"
        label="Selected skills"
      />
      <input
        id={id}
        className="form-input"
        list={`${id}-list`}
        placeholder="Type a skill and press Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        aria-describedby={`${id}-hint`}
      />
      <datalist id={`${id}-list`}>
        {remaining.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p id={`${id}-hint`} className="form-hint">
        Press Enter to add. Backspace on an empty field removes the last skill.
      </p>
      {remaining.length > 0 && (
        <div className="suggestions" role="group" aria-label="Suggested skills">
          {remaining.map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default SkillsInput;
