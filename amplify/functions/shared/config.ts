/**
 * Deployment settings injected as environment variables from SSM Parameter Store
 * (/teamtask/ses/senderEmail, /teamtask/app/url — see amplify/backend.ts). Never hard-coded.
 */
export function config(name: "SENDER_EMAIL" | "APP_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured (SSM parameter missing?)`);
  return value;
}
