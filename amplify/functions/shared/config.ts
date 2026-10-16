/**
 * Deployment settings: Amplify secrets (SSM Parameter Store) that Amplify loads into the
 * function's environment at start-up — see amplify/backend.ts. Never hard-coded.
 */
export function config(name: "SENDER_EMAIL" | "APP_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured (SSM parameter missing?)`);
  return value;
}
