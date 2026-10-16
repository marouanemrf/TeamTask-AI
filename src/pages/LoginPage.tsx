import LoginLayout from "../components/layout/LoginLayout";
import LoginForm from "../components/ui/LoginForm";
import type { LoginFormProps } from "../components/ui/LoginForm";
import NewPasswordForm from "../components/ui/NewPasswordForm";

export interface LoginPageProps extends LoginFormProps {
  /** When set, the card asks for a new password instead of the sign-in form. */
  onNewPassword?: (newPassword: string) => Promise<void>;
}

function LoginPage({ onSubmit, error, onNewPassword }: LoginPageProps) {
  return (
    <LoginLayout>
      {onNewPassword ? (
        <>
          <header className="login-card__header">
            <h1 className="login-card__title">Choose a new password</h1>
            <p className="login-card__subtitle">Replace your temporary password to finish signing in.</p>
          </header>
          <NewPasswordForm onSubmit={onNewPassword} error={error} />
        </>
      ) : (
        <>
          <header className="login-card__header">
            <h1 className="login-card__title">Sign in</h1>
            <p className="login-card__subtitle">Access your Team Task workspace.</p>
          </header>
          <LoginForm onSubmit={onSubmit} error={error} />
        </>
      )}
    </LoginLayout>
  );
}

export default LoginPage;
