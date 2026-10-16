import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { Task } from "../../services/client";
import { BLOCK_REASON_MAX, BLOCK_REASON_MIN, validateBlockReason } from "../../utils/taskRules";
import Modal from "../ui/Modal";

export interface BlockerModalProps {
  task: Task;
  submitting: boolean;
  error: string | null;
  /** Resolves to true when the task was marked BLOCKED (the modal then closes). */
  onSubmit: (reason: string) => Promise<boolean>;
  onClose: () => void;
}

/** "Report a blocker": sets the task to Blocked with a mandatory reason (kept in the audit log). */
function BlockerModal({ task, submitting, error, onSubmit, onClose }: BlockerModalProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const length = reason.trim().length;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const problem = validateBlockReason(reason);
    setFieldError(problem ?? null);
    if (problem) {
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    if (await onSubmit(reason.trim())) onClose();
  }

  return (
    <Modal
      title="Report a blocker"
      description={
        <>
          <strong>{task.title}</strong> will move to Blocked. Explain what is blocking it so your manager can help.
        </>
      }
      onClose={onClose}
      busy={submitting}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="button-danger" disabled={submitting}>
            {submitting ? "Reporting…" : "Report blocker"}
          </button>
        </>
      }
    >
      <div className="form-field">
        <label className="form-field__label" htmlFor={`${id}-reason`}>
          Reason <span aria-hidden="true">*</span>
        </label>
        <textarea
          id={`${id}-reason`}
          className="form-input form-textarea"
          rows={4}
          maxLength={BLOCK_REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (fieldError) setFieldError(validateBlockReason(e.target.value) ?? null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${id}-reason-hint${fieldError ? ` ${id}-reason-error` : ""}`}
          disabled={submitting}
        />
        <p id={`${id}-reason-hint`} className="form-hint">
          At least {BLOCK_REASON_MIN} characters · {length}/{BLOCK_REASON_MAX}
        </p>
        {fieldError && (
          <p id={`${id}-reason-error`} className="form-field__error">
            {fieldError}
          </p>
        )}
      </div>
      {error && (
        <div className="form-alert" role="alert">
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}

export default BlockerModal;
