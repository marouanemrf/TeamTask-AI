import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { confirmPasswordReset, requestPasswordReset } from "../../services/authService";
import { describeResetError } from "../../utils/authErrors";
import { validateEmail, validateNewPassword } from "../../utils/validation";

const RESEND_COOLDOWN_S = 60;
const CODE_PATTERN = /^\d{6}$/;

export interface ForgotPasswordFormProps {
  /** Email typed on the sign-in form, if any. */
  initialEmail?: string;
  /** Back to sign in (with the email, so it is prefilled). `reset` = the password was changed. */
  onDone: (email: string, reset: boolean) => void;
}

type Step = "email" | "code";

/**
 * Forgotten password with Cognito: 1) email → a 6-digit code is emailed, 2) code + new password.
 * The messages never reveal whether an account exists for the email.
 */
function ForgotPasswordForm({ initialEmail = "", onDone }: ForgotPasswordFormProps) {
  const id = useId();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ email?: string; code?: string; password?: string; confirm?: string }>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    setBusy(true);
    setAlert(null);
    try {
      setDestination(await requestPasswordReset(email));
      setStep("code");
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      console.error("[ForgotPasswordForm] Code request failed", err);
      // An unknown account behaves like a known one: go on to the code step.
      if (err instanceof Error && err.name === "UserNotFoundException") {
        setStep("code");
        setCooldown(RESEND_COOLDOWN_S);
      } else setAlert(describeResetError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateEmail(email);
    setErrors({ email: problem });
    if (problem) return firstField.current?.focus();
    await sendCode();
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      code: CODE_PATTERN.test(code.trim()) ? undefined : "Enter the 6-digit code from the email.",
      password: validateNewPassword(password),
      confirm: confirm === password ? undefined : "Passwords do not match.",
    };
    setErrors(next);
    const first = (["code", "password", "confirm"] as const).find((k) => next[k]);
    if (first) return document.getElementById(`${id}-${first}`)?.focus();
    setBusy(true);
    setAlert(null);
    try {
      await confirmPasswordReset(email, code, password);
      onDone(email.trim(), true);
    } catch (err) {
      console.error("[ForgotPasswordForm] Reset failed", err);
      setAlert(describeResetError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: "email" | "code" | "password" | "confirm") => ({
    id: `${id}-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
  });
  const fieldError = (key: "email" | "code" | "password" | "confirm") =>
    errors[key] && <p id={`${id}-${key}-error`} className="form-field__error">{errors[key]}</p>;
  const alertBox = alert && (
    <div className="form-alert" role="alert">
      <span>{alert}</span>
    </div>
  );

  if (step === "email") {
    return (
      <form className="login-form" onSubmit={(e) => void handleEmail(e)} noValidate aria-busy={busy}>
        <fieldset className="login-form__fieldset" disabled={busy}>
          <legend className="visually-hidden">Reset your password</legend>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-email`}>Email address</label>
            <input ref={firstField} className="form-input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} {...field("email")} />
            {fieldError("email")}
          </div>
          {alertBox}
          <button type="submit" className="button-primary button--block">
            {busy && <span className="spinner" aria-hidden="true" />}
            <span>{busy ? "Sending…" : "Send reset code"}</span>
          </button>
          <p className="form-helper">
            <button type="button" className="text-button" onClick={() => onDone(email.trim(), false)}>Back to sign in</button>
          </p>
        </fieldset>
      </form>
    );
  }

  return (
    <form className="login-form" onSubmit={(e) => void handleReset(e)} noValidate aria-busy={busy}>
      <fieldset className="login-form__fieldset" disabled={busy}>
        <legend className="visually-hidden">Choose a new password</legend>
        <p className="form-hint" role="status">
          A 6-digit code was sent{destination ? ` to ${destination}` : ""}. It expires after one hour.
        </p>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-code`}>Reset code</label>
          <input ref={firstField} className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} {...field("code")} />
          {fieldError("code")}
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-password`}>New password</label>
          <input className="form-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} {...field("password")} />
          {fieldError("password") || <p className="form-hint">At least 8 characters with uppercase, lowercase, a number and a symbol.</p>}
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-confirm`}>Confirm new password</label>
          <input className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} {...field("confirm")} />
          {fieldError("confirm")}
        </div>
        {alertBox}
        <button type="submit" className="button-primary button--block">
          {busy && <span className="spinner" aria-hidden="true" />}
          <span>{busy ? "Saving…" : "Reset password"}</span>
        </button>
        <div className="login-card__actions">
          <button type="button" className="text-button" disabled={cooldown > 0} onClick={() => void sendCode()}>
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </button>
          <button type="button" className="text-button" onClick={() => onDone(email.trim(), false)}>Back to sign in</button>
        </div>
      </fieldset>
    </form>
  );
}

export default ForgotPasswordForm;
