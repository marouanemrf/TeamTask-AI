/** Turns Cognito errors into short messages that don't reveal whether an account exists. */
export function describeAuthError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "InvalidPasswordException":
      return "This password doesn't meet the security policy.";
    case "PasswordResetRequiredException":
      return "A password reset is required. Contact your administrator.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
