/** Up to two initials for an avatar ("Marouane Morfi" → "MM", "Sara" → "SA"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// One implementation for the app and the functions (the backend never imports from src/).
import { normalizeEmail, normalizeUsername } from "../../amplify/functions/shared/text";
export { normalizeEmail, normalizeUsername } from "../../amplify/functions/shared/text";

/* -------------------------------------------------------------------------- */
/* Usernames: 3–30 chars, lowercase letters, digits, . _ - (not at the edges)  */
/* -------------------------------------------------------------------------- */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;


export function validateUsername(value: string): string | undefined {
  const username = normalizeUsername(value);
  if (!username) return "Username is required.";
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Use lowercase letters, numbers, dots, dashes or underscores (not at the start or end).";
  }
  return undefined;
}

/** Suggests a username from an email's local part ("Marouane.Morfi@x.com" → "marouane.morfi"). */
export function suggestUsername(email: string): string {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  return local
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, USERNAME_MAX);
}
