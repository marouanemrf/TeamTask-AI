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

/** Messages for the email verification step (Cognito attribute verification errors). */
export function describeVerificationError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "CodeMismatchException":
      return "This code is incorrect. Check the latest email and try again.";
    case "ExpiredCodeException":
      return "This code has expired or was already used. Send a new code.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Wait a few minutes before trying again.";
    case "CodeDeliveryFailureException":
      return "The email couldn't be sent. Try again later or contact your administrator.";
    case "NotAuthorizedException":
      return "Your session has expired. Sign in again.";
    default:
      return "Verification failed. Please try again.";
  }
}
