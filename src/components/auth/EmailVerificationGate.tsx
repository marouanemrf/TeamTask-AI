import { useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useEmailVerification } from "../../hooks/useEmailVerification";
import LoginLayout from "../layout/LoginLayout";

const CODE_PATTERN = /^\d{6}$/;

export interface EmailVerificationGateProps {
  children: ReactNode;
  onSignOut: () => void;
}

/**
 * Signed-in users must verify their email before using the app. Accounts created by an
 * administrator start unverified; the code is emailed by Cognito (secure, single-use, expires).
 * The APIs refuse unverified accounts too, so this screen is not the only check.
 */
function EmailVerificationGate({ children, onSignOut }: EmailVerificationGateProps) {
  const v = useEmailVerification();
  const id = useId();
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (v.status === "checking") return null;
  if (v.status === "verified" && !justVerified) return <>{children}</>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = code.replace(/\s/g, "");
    if (!CODE_PATTERN.test(clean)) {
      setFieldError("Enter the 6-digit code from the email.");
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    if (await v.confirm(clean)) setJustVerified(true);
    else inputRef.current?.select();
  }

  if (justVerified) {
    return (
      <LoginLayout>
        <header className="login-card__header">
          <h1 className="login-card__title">Email verified</h1>
          <p className="login-card__subtitle">Your account is verified. You can now use TeamTask.</p>
        </header>
        <div className="status-region" role="status">
          <p className="notice">Verification successful.</p>
        </div>
        <button type="button" className="button-primary button--block" onClick={() => setJustVerified(false)} autoFocus>
          Continue
        </button>
      </LoginLayout>
    );
  }

  if (v.status === "error") {
    return (
      <LoginLayout>
        <header className="login-card__header">
          <h1 className="login-card__title">Verify your email</h1>
        </header>
        <div className="form-alert" role="alert">
          <span>We couldn't check your account. Reload the page or sign in again.</span>
        </div>
        <button type="button" className="button-secondary button--block" onClick={onSignOut}>
          Sign out
        </button>
      </LoginLayout>
    );
  }

  return (
    <LoginLayout>
      <header className="login-card__header">
        <h1 className="login-card__title">Verify your email</h1>
        <p className="login-card__subtitle">
          Your account needs email verification before you can use TeamTask.
          {v.destination ? ` We sent a code to ${v.destination}.` : ""}
        </p>
      </header>
      <form className="login-form" onSubmit={(e) => void submit(e)} noValidate aria-busy={v.confirming}>
        <fieldset className="login-form__fieldset" disabled={v.confirming}>
          <legend className="visually-hidden">Email verification</legend>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-code`}>
              Verification code
            </label>
            <input
              ref={inputRef}
              id={`${id}-code`}
              className="form-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${id}-code-error` : undefined}
              autoFocus
            />
            {fieldError && (
              <p id={`${id}-code-error`} className="form-field__error">
                {fieldError}
              </p>
            )}
          </div>
          {v.error && (
            <div className="form-alert" role="alert">
              <span>{v.error}</span>
            </div>
          )}
          <div className="status-region" role="status">
            {v.notice && <p className="notice">{v.notice}</p>}
          </div>
          <button type="submit" className="button-primary button--block">
            {v.confirming && <span className="spinner" aria-hidden="true" />}
            <span>{v.confirming ? "Verifying…" : "Verify email"}</span>
          </button>
        </fieldset>
      </form>
      <div className="login-card__actions">
        <button type="button" className="button-secondary" onClick={() => void v.send()} disabled={v.sending || v.cooldown > 0}>
          {v.sending ? "Sending…" : v.cooldown > 0 ? `Resend code (${v.cooldown}s)` : "Resend code"}
        </button>
        <button type="button" className="text-button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </LoginLayout>
  );
}

export default EmailVerificationGate;
