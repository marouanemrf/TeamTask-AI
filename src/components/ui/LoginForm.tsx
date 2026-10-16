import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { validateEmail, validateRequiredPassword } from "../../utils/validation";

export interface LoginFormProps {
  onSubmit?: (email: string, password: string) => Promise<void>;
  error?: string;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

const SIMULATED_DELAY_MS = 1000;
const GENERIC_FAILURE = "Sign-in failed. Please try again.";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function LoginForm({ onSubmit, error }: LoginFormProps) {
  const id = useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const emailErrorId = `${id}-email-error`;
  const passwordErrorId = `${id}-password-error`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState({ email: false, password: false });
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const wasLoadingRef = useRef(false);

  const alertMessage = submitError ?? error;

  // Disabling the fieldset drops focus to <body>; hand it back to the submit
  // button once the request settles so keyboard users keep their place.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && document.activeElement === document.body) {
      submitRef.current?.focus();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setEmail(value);
    if (touched.email) setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setPassword(value);
    if (touched.password) setErrors((prev) => ({ ...prev, password: validateRequiredPassword(value) }));
  }

  function handleEmailBlur() {
    // Don't nag on a field the user merely tabbed through.
    if (!email && !touched.email) return;
    setTouched((prev) => ({ ...prev, email: true }));
    setErrors((prev) => ({ ...prev, email: validateEmail(email) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validateRequiredPassword(password),
    };
    setErrors(nextErrors);
    setTouched({ email: true, password: true });

    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.password) {
      passwordRef.current?.focus();
      return;
    }

    const normalizedEmail = email.trim();
    submittingRef.current = true;
    setIsLoading(true);
    setSubmitError(null);

    try {
      if (onSubmit) {
        await onSubmit(normalizedEmail, password);
      } else {
        await wait(SIMULATED_DELAY_MS);
        // Demo mode: no network call. The password is masked to keep it out of logs.
        console.info("[LoginForm] Simulated submission", {
          email: normalizedEmail,
          password: "•".repeat(password.length),
        });
      }
    } catch (err) {
      console.error("[LoginForm] Submission failed", err);
      setSubmitError(GENERIC_FAILURE);
    } finally {
      submittingRef.current = false;
      setIsLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate aria-busy={isLoading}>
      <fieldset className="login-form__fieldset" disabled={isLoading}>
        <legend className="visually-hidden">Sign-in credentials</legend>

        <div className="form-field">
          <label className="form-field__label" htmlFor={emailId}>
            Email address
          </label>
          <input
            ref={emailRef}
            id={emailId}
            className="form-input"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="name@example.com"
            value={email}
            onChange={handleEmailChange}
            onBlur={handleEmailBlur}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? emailErrorId : undefined}
          />
          {errors.email && (
            <p id={emailErrorId} className="form-field__error">
              {errors.email}
            </p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={passwordId}>
            Password
          </label>
          <div className="form-field__control">
            <input
              ref={passwordRef}
              id={passwordId}
              className="form-input form-input--with-action"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={handlePasswordChange}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? passwordErrorId : undefined}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-controls={passwordId}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {errors.password && (
            <p id={passwordErrorId} className="form-field__error">
              {errors.password}
            </p>
          )}
        </div>

        <div className="form-row-end">
          <a className="text-link" href="#">
            Forgot password?
          </a>
        </div>

        {alertMessage && (
          <div className="form-alert" role="alert">
            <AlertIcon />
            <span>{alertMessage}</span>
          </div>
        )}

        <button ref={submitRef} type="submit" className="button-primary button--block">
          {isLoading && <span className="spinner" aria-hidden="true" />}
          <span>{isLoading ? "Signing in…" : "Sign in"}</span>
        </button>

        <p className="form-helper">No account? Contact your administrator.</p>
      </fieldset>
    </form>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6" />
      <path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export default LoginForm;
