import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { Milestone } from "../../services/client";
import { formatDate } from "../../utils/dates";
import LoadingState from "../ui/LoadingState";

export interface MilestonesPanelProps {
  milestones: Milestone[];
  loading: boolean;
  today: string;
  canCreate: boolean;
  submitting: boolean;
  error: string | null;
  onCreate: (name: string, dueDate: string) => Promise<boolean>;
}

/** Milestones list (by due date) and, for managers, an inline create form. */
function MilestonesPanel({ milestones, loading, today, canCreate, submitting, error, onCreate }: MilestonesPanelProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setNameError("Name is required.");
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    setNameError(null);
    if (await onCreate(name.trim(), dueDate)) {
      setName("");
      setDueDate("");
    }
  }

  return (
    <div className="page-stack">
      {canCreate && (
        <form className="panel milestone-form" onSubmit={handleSubmit} noValidate aria-label="New milestone">
          <div className="form-field milestone-form__name">
            <label className="form-field__label" htmlFor={`${id}-name`}>
              Milestone name <span aria-hidden="true">*</span>
            </label>
            <input
              id={`${id}-name`}
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
            />
            {nameError && (
              <p id={`${id}-name-error`} className="form-field__error">
                {nameError}
              </p>
            )}
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-due`}>
              Due date
            </label>
            <input id={`${id}-due`} className="form-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <button type="submit" className="button-primary button-primary--inline milestone-form__submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add milestone"}
          </button>
          {error && (
            <div className="form-alert milestone-form__error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </form>
      )}

      {loading ? (
        <LoadingState className="empty-state panel">Loading milestones…</LoadingState>
      ) : milestones.length === 0 ? (
        <p className="empty-state panel">No milestones yet.</p>
      ) : (
        <ol className="panel milestone-list">
          {milestones.map((m) => {
            const past = !!m.dueDate && m.dueDate < today;
            return (
              <li key={m.id} className="milestone-list__item">
                <span className={`milestone-list__dot${past ? " milestone-list__dot--past" : ""}`} aria-hidden="true" />
                <span className="milestone-list__name">{m.name}</span>
                <span className="milestone-list__date">
                  {m.dueDate ? formatDate(m.dueDate) : "No date"}
                  {past && <span className="text-muted"> · passed</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default MilestonesPanel;
