import { useCallback, useState } from "react";
import { completeNewPassword, signInWithEmail } from "../services/authService";
import type { SignInResult } from "../services/authService";
import { describeAuthError } from "../utils/authErrors";

const UNSUPPORTED_STEP = "Additional verification is required. Contact your administrator.";

/** Drives the login page: credentials, then the first-login new-password step if Cognito asks for it. */
export function useSignIn() {
  const [error, setError] = useState<string>();
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

  const handleResult = useCallback((result: SignInResult) => {
    setNeedsNewPassword(result === "NEW_PASSWORD_REQUIRED");
    if (result === "SIGNED_IN") {
      // Re-bootstrap the app from Cognito's persisted session. This avoids leaving
      // the login screen mounted if the Authenticator provider misses the auth event.
      window.location.reload();
      return;
    }
    if (result === "UNSUPPORTED_STEP") setError(UNSUPPORTED_STEP);
  }, []);

  const submitCredentials = useCallback(
    async (email: string, password: string) => {
      setError(undefined);
      try {
        handleResult(await signInWithEmail(email, password));
      } catch (err) {
        console.error("[useSignIn] Sign-in failed", err);
        setError(describeAuthError(err));
      }
    },
    [handleResult],
  );

  const submitNewPassword = useCallback(
    async (newPassword: string) => {
      setError(undefined);
      try {
        handleResult(await completeNewPassword(newPassword));
      } catch (err) {
        console.error("[useSignIn] New password rejected", err);
        setError(describeAuthError(err));
      }
    },
    [handleResult],
  );

  return { error, needsNewPassword, submitCredentials, submitNewPassword };
}
