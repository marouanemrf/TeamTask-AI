import { CloseIcon } from "../ui/Icons";

export interface SkillChipsProps {
  skills: ReadonlyArray<string | null>;
  /** Show at most this many chips, then "+N". */
  max?: number;
  /** When set, each chip gets a remove button (used in the member form). */
  onRemove?: (skill: string) => void;
  emptyLabel?: string;
  /** Accessible name of the list (must differ from any nearby input label). */
  label?: string;
}

function SkillChips({ skills, max, onRemove, emptyLabel = "No skills listed", label = "Skills" }: SkillChipsProps) {
  const list = skills.filter((s): s is string => !!s);
  if (list.length === 0) return <p className="text-muted chip-empty">{emptyLabel}</p>;

  const shown = max ? list.slice(0, max) : list;
  const hidden = list.length - shown.length;

  return (
    <ul className="chips" aria-label={label}>
      {shown.map((skill) => (
        <li key={skill} className="chip">
          <span>{skill}</span>
          {onRemove && (
            <button type="button" className="chip__remove" onClick={() => onRemove(skill)} aria-label={`Remove ${skill}`}>
              <CloseIcon />
            </button>
          )}
        </li>
      ))}
      {hidden > 0 && <li className="chip chip--more">+{hidden}</li>}
    </ul>
  );
}

export default SkillChips;
