import { useState } from "react";
import LoginLayout from "../components/layout/LoginLayout";
import BlurText from "../components/reactbits/BlurText";
import ForgotPasswordForm from "../components/ui/ForgotPasswordForm";
import LoginForm from "../components/ui/LoginForm";
import type { LoginFormProps } from "../components/ui/LoginForm";
import NewPasswordForm from "../components/ui/NewPasswordForm";

export interface LoginPageProps extends Pick<LoginFormProps, "onSubmit" | "error"> {
  /** When set, the card asks for a new password instead of the sign-in form. */
  onNewPassword?: (newPassword: string) => Promise<void>;
}

/** Sign in, first-login new password, or forgotten password (Cognito reset code). */
function LoginPage({ onSubmit, error, onNewPassword }: LoginPageProps) {
  const [forgot, setForgot] = useState<{ email: string } | null>(null);
  const [signIn, setSignIn] = useState<{ email: string; notice?: string }>({ email: "" });

  if (onNewPassword) {
    return (
      <LoginLayout>
        <header className="login-card__header">
          <BlurText as="h1" className="login-card__title" text="Choose a new password" delay={90} />
          <p className="login-card__subtitle">Replace your temporary password to finish signing in.</p>
        </header>
        <NewPasswordForm onSubmit={onNewPassword} error={error} />
      </LoginLayout>
    );
  }

  if (forgot) {
    return (
      <LoginLayout>
        <header className="login-card__header">
          <BlurText as="h1" className="login-card__title" text="Reset your password" delay={90} />
          <p className="login-card__subtitle">We'll email you a code to choose a new password.</p>
        </header>
        <ForgotPasswordForm
          initialEmail={forgot.email}
          onDone={(email, reset) => {
            setSignIn({ email, notice: reset ? "Password changed. Sign in with your new password." : undefined });
            setForgot(null);
          }}
        />
      </LoginLayout>
    );
  }

  return (
    <LoginLayout>
      <header className="login-card__header">
        <BlurText as="h1" className="login-card__title" text="Sign in" delay={90} />
        <p className="login-card__subtitle">Access your Team Task workspace.</p>
      </header>
      <LoginForm
        key={`${signIn.email}|${signIn.notice ?? ""}`}
        onSubmit={onSubmit}
        error={error}
        initialEmail={signIn.email}
        notice={signIn.notice}
        onForgotPassword={(email) => setForgot({ email })}
      />
    </LoginLayout>
  );
}

export default LoginPage;
