import { useId, useState } from "react";
import type { AssigneeOption } from "../../utils/taskRules";

export interface ReassignControlProps {
  taskTitle: string;
  /** Other members, best match first (see rankAssignees). */
  options: AssigneeOption[];
  requiredSkillCount: number;
  busy: boolean;
  onConfirm: (assigneeId: string) => void;
  onCancel: () => void;
}

/** Inline picker shown under a task: suggested members with skill match and load. */
function ReassignControl({ taskTitle, options, requiredSkillCount, busy, onConfirm, onCancel }: ReassignControlProps) {
  const id = useId();
  const [assigneeId, setAssigneeId] = useState(options[0]?.member.id ?? "");
  const selected = options.find((o) => o.member.id === assigneeId);

  if (options.length === 0) {
    return (
      <div className="reassign">
        <p className="form-hint">No other team member available.</p>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="reassign" role="group" aria-label={`Reassign ${taskTitle}`}>
      <label className="form-field__label" htmlFor={`${id}-member`}>
        Reassign to
      </label>
      <div className="reassign__row">
        <select id={`${id}-member`} className="form-input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={busy}>
          {options.map((o) => (
            <option key={o.member.id} value={o.member.id}>
              {o.member.name} — {requiredSkillCount ? `${o.matches}/${requiredSkillCount} skills · ` : ""}
              {o.workloadPercent}% load
            </option>
          ))}
        </select>
        <button type="button" className="button-primary button-primary--inline" onClick={() => onConfirm(assigneeId)} disabled={busy || !assigneeId}>
          {busy ? "Reassigning…" : "Confirm"}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {selected && selected.projectedPercent > 100 && (
        <p className="form-warning">
          {selected.member.name} would reach {selected.projectedPercent}% of their weekly capacity.
        </p>
      )}
    </div>
  );
}

export default ReassignControl;
