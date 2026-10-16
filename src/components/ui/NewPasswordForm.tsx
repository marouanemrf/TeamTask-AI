import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { validateNewPassword } from "../../utils/validation";

export interface NewPasswordFormProps {
  onSubmit: (newPassword: string) => Promise<void>;
  error?: string;
}

/** Shown on first sign-in, when an administrator-created account must replace its temporary password. */
function NewPasswordForm({ onSubmit, error }: NewPasswordFormProps) {
  const id = useId();
  const passwordId = `${id}-new`;
  const confirmId = `${id}-confirm`;
  const passwordErrorId = `${id}-new-error`;
  const confirmErrorId = `${id}-confirm-error`;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const submittingRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors = {
      password: validateNewPassword(password),
      confirm: confirm === password ? undefined : "Passwords do not match.",
    };
    setErrors(nextErrors);
    if (nextErrors.password) return passwordRef.current?.focus();
    if (nextErrors.confirm) return confirmRef.current?.focus();

    submittingRef.current = true;
    setIsLoading(true);
    try {
      await onSubmit(password);
    } finally {
      submittingRef.current = false;
      setIsLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate aria-busy={isLoading}>
      <fieldset className="login-form__fieldset" disabled={isLoading}>
        <legend className="visually-hidden">Choose a new password</legend>

        <div className="form-field">
          <label className="form-field__label" htmlFor={passwordId}>
            New password
          </label>
          <input
            ref={passwordRef}
            id={passwordId}
            className="form-input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? passwordErrorId : undefined}
          />
          {errors.password && (
            <p id={passwordErrorId} className="form-field__error">
              {errors.password}
            </p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={confirmId}>
            Confirm password
          </label>
          <input
            ref={confirmRef}
            id={confirmId}
            className="form-input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? confirmErrorId : undefined}
          />
          {errors.confirm && (
            <p id={confirmErrorId} className="form-field__error">
              {errors.confirm}
            </p>
          )}
        </div>

        {error && (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="button-primary button--block">
          {isLoading && <span className="spinner" aria-hidden="true" />}
          <span>{isLoading ? "Saving…" : "Set password and sign in"}</span>
        </button>
      </fieldset>
    </form>
  );
}

export default NewPasswordForm;
