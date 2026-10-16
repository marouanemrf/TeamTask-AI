import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { Project, ProjectStatus } from "../../services/client";
import type { ProjectChanges } from "../../services/projectService";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "../../utils/projectLabels";
import Modal from "../ui/Modal";

export interface ProjectEditModalProps {
  project: Project;
  submitting: boolean;
  error: string | null;
  onSubmit: (changes: ProjectChanges) => Promise<boolean>;
  onClose: () => void;
}

/** Managers edit status, dates and objective. */
function ProjectEditModal({ project, submitting, error, onSubmit, onClose }: ProjectEditModalProps) {
  const id = useId();
  const [status, setStatus] = useState<ProjectStatus>(project.status ?? "DRAFT");
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [endDate, setEndDate] = useState(project.endDate ?? "");
  const [objective, setObjective] = useState(project.objective ?? "");
  const [businessImpact, setBusinessImpact] = useState(project.businessImpact ?? "");
  const [importanceOverride, setImportanceOverride] = useState(project.importanceOverride?.toString() ?? "");
  const [urgencyOverride, setUrgencyOverride] = useState(project.urgencyOverride?.toString() ?? "");
  const [dateError, setDateError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (startDate && endDate && endDate <= startDate) {
      setDateError("End date must be after the start date.");
      document.getElementById(`${id}-end`)?.focus();
      return;
    }
    setDateError(null);
    if (await onSubmit({ status, startDate, endDate, objective: objective.trim(), businessImpact: (businessImpact || undefined) as ProjectChanges["businessImpact"], importanceOverride: importanceOverride ? Number(importanceOverride) : undefined, urgencyOverride: urgencyOverride ? Number(urgencyOverride) : undefined })) onClose();
  }

  return (
    <Modal
      title="Edit project"
      description={project.name}
      onClose={onClose}
      busy={submitting}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="button-primary button-primary--inline" disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            <span>{submitting ? "Saving…" : "Save changes"}</span>
          </button>
        </>
      }
    >
      <fieldset className="modal__fields" disabled={submitting}>
        <legend className="visually-hidden">Project details</legend>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-status`}>
            Status
          </label>
          <select id={`${id}-status`} className="form-input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <label className="form-field"><span className="form-field__label">Business impact</span><select className="form-input" value={businessImpact} onChange={(e) => setBusinessImpact(e.target.value)}><option value="">Not assessed</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
        <div className="modal__row"><label className="form-field"><span className="form-field__label">Importance override (1–5)</span><select className="form-input" value={importanceOverride} onChange={(e) => setImportanceOverride(e.target.value)}><option value="">Automatic / unknown</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label><label className="form-field"><span className="form-field__label">Urgency override (1–5)</span><select className="form-input" value={urgencyOverride} onChange={(e) => setUrgencyOverride(e.target.value)}><option value="">Automatic / unknown</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
        <div className="modal__row">
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-start`}>
              Start date
            </label>
            <input id={`${id}-start`} className="form-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-end`}>
              End date
            </label>
            <input
              id={`${id}-end`}
              className="form-input"
              type="date"
              min={startDate || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? `${id}-end-error` : undefined}
            />
            {dateError && (
              <p id={`${id}-end-error`} className="form-field__error">
                {dateError}
              </p>
            )}
          </div>
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-objective`}>
            Objective
          </label>
          <textarea id={`${id}-objective`} className="form-input form-textarea" rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </div>
        {error && (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        )}
      </fieldset>
    </Modal>
  );
}

export default ProjectEditModal;
