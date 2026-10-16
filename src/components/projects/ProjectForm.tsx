import { useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { ProjectFormValues } from "../../hooks/useCreateProject";
import type { ProjectStatus } from "../../services/client";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "../../utils/projectLabels";
import { validateProjectForm } from "../../utils/projectValidation";
import type { ProjectFormErrors } from "../../utils/projectValidation";

export interface ProjectFormProps {
  defaultManagerEmail: string;
  submitting: boolean;
  /** API error, already a user-facing message. */
  error: string | null;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
}

type FieldName = keyof ProjectFormErrors;

/** Project creation form with inline, accessible validation. */
function ProjectForm({ defaultManagerEmail, submitting, error, onSubmit, onCancel }: ProjectFormProps) {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;
  const errorId = (name: FieldName) => `${id}-${name}-error`;

  const [values, setValues] = useState<ProjectFormValues>({
    name: "",
    clientName: "",
    objective: "",
    startDate: "",
    endDate: "",
    status: "DRAFT",
    managerEmail: defaultManagerEmail,
    businessImpact: undefined,
    importanceOverride: undefined,
    urgencyOverride: undefined,
  });
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const managerEmailRef = useRef<HTMLInputElement>(null);

  function update(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    const next = { ...values, [name]: name === "status" ? (value as ProjectStatus) : value };
    setValues(next);
    // After a first submit, keep errors in sync as the user fixes them.
    if (submitted) setErrors(validateProjectForm(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitted(true);
    const nextErrors = validateProjectForm(values);
    setErrors(nextErrors);
    // Focus the first invalid field, in form order.
    const firstInvalid = [
      { error: nextErrors.name, ref: nameRef },
      { error: nextErrors.endDate, ref: endDateRef },
      { error: nextErrors.managerEmail, ref: managerEmailRef },
    ].find((field) => field.error);
    if (firstInvalid) {
      firstInvalid.ref.current?.focus();
      return;
    }
    onSubmit({
      ...values,
      name: values.name.trim(),
      clientName: values.clientName?.trim(),
      objective: values.objective?.trim(),
      managerEmail: values.managerEmail?.trim(),
    });
  }

  const invalidProps = (name: FieldName) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? errorId(name) : undefined,
  });

  const fieldError = (name: FieldName) =>
    errors[name] && (
      <p id={errorId(name)} className="form-field__error">
        {errors[name]}
      </p>
    );

  return (
    <form className="panel project-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <fieldset className="project-form__grid" disabled={submitting}>
        <legend className="visually-hidden">Project details</legend>

        <div className="form-field project-form__full">
          <label className="form-field__label" htmlFor={fieldId("name")}>
            Name <span aria-hidden="true">*</span>
          </label>
          <input
            ref={nameRef}
            id={fieldId("name")}
            name="name"
            className="form-input"
            required
            value={values.name}
            onChange={update}
            {...invalidProps("name")}
          />
          {fieldError("name")}
        </div>

        <div className="modal__row project-form__full">
          <label className="form-field"><span className="form-field__label">Business impact</span><select className="form-input" value={values.businessImpact ?? ""} onChange={(e) => setValues({ ...values, businessImpact: (e.target.value || undefined) as ProjectFormValues["businessImpact"] })}><option value="">Not assessed</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
          <label className="form-field"><span className="form-field__label">Importance override (1–5)</span><select className="form-input" value={values.importanceOverride ?? ""} onChange={(e) => setValues({ ...values, importanceOverride: e.target.value ? Number(e.target.value) : undefined })}><option value="">Automatic / unknown</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="form-field"><span className="form-field__label">Urgency override (1–5)</span><select className="form-input" value={values.urgencyOverride ?? ""} onChange={(e) => setValues({ ...values, urgencyOverride: e.target.value ? Number(e.target.value) : undefined })}><option value="">Automatic / unknown</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={fieldId("client")}>
            Client
          </label>
          <input id={fieldId("client")} name="clientName" className="form-input" value={values.clientName} onChange={update} />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={fieldId("status")}>
            Status
          </label>
          <select id={fieldId("status")} name="status" className="form-input" value={values.status} onChange={update}>
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field project-form__full">
          <label className="form-field__label" htmlFor={fieldId("objective")}>
            Objective
          </label>
          <textarea
            id={fieldId("objective")}
            name="objective"
            className="form-input form-textarea"
            rows={4}
            value={values.objective}
            onChange={update}
          />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={fieldId("start")}>
            Start date
          </label>
          <input id={fieldId("start")} name="startDate" type="date" className="form-input" value={values.startDate} onChange={update} />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={fieldId("end")}>
            End date
          </label>
          <input
            ref={endDateRef}
            id={fieldId("end")}
            name="endDate"
            type="date"
            className="form-input"
            min={values.startDate || undefined}
            value={values.endDate}
            onChange={update}
            {...invalidProps("endDate")}
          />
          {fieldError("endDate")}
        </div>

        <div className="form-field project-form__full">
          <label className="form-field__label" htmlFor={fieldId("manager")}>
            Manager email
          </label>
          <input
            ref={managerEmailRef}
            id={fieldId("manager")}
            name="managerEmail"
            type="email"
            autoComplete="email"
            className="form-input"
            value={values.managerEmail}
            onChange={update}
            {...invalidProps("managerEmail")}
          />
          {fieldError("managerEmail")}
        </div>

        {error && (
          <div className="form-alert project-form__full" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="project-form__actions project-form__full">
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button-primary button-primary--inline">
            {submitting && <span className="spinner" aria-hidden="true" />}
            <span>{submitting ? "Creating…" : "Create project"}</span>
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export default ProjectForm;
