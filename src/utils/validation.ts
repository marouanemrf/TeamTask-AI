const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Email address is required.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address (e.g. name@example.com).";
  return undefined;
}

export function validateRequiredPassword(value: string): string | undefined {
  return value ? undefined : "Password is required.";
}

/** Mirrors the default Cognito password policy so most mistakes are caught before the request. */
export function validateNewPassword(value: string): string | undefined {
  if (!value) return "New password is required.";
  if (value.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return "Include uppercase, lowercase, a number and a symbol.";
  }
  return undefined;
}
