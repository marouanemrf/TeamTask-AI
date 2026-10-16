/** Text normalisation shared by the functions and the React app (src/utils/text.ts re-exports it). */

/** Case-insensitive key for comparing emails. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lowercases and drops a leading "@" — what the user typed becomes the stored form. */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}
