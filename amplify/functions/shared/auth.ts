import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { fail } from "./errors";
import { toRoles } from "./rules";
import type { Role } from "./rules";
import { organisationFromGroups } from "./tenancy";

export interface Caller {
  username: string;
  email: string;
  roles: Role[];
  /** From the organisation group of the token (set by the server only); undefined if none. */
  organisationId?: string;
}

interface CognitoIdentityLike {
  username?: string;
  sub?: string;
  groups?: string[] | null;
  claims?: Record<string, unknown>;
}

const cognito = new CognitoIdentityProviderClient({});
// username → email of VERIFIED accounts, kept for the lifetime of the Lambda container
// (unverified accounts are looked up again, so a fresh verification takes effect immediately).
const emailCache = new Map<string, string>();

/**
 * The AppSync user-pool requests are signed with the *access* token, which has no email claim.
 * When the claim is missing, the email is read from the user pool (AdminGetUser).
 */
async function emailFor(identity: CognitoIdentityLike, username: string): Promise<string> {
  const claimed = identity.claims?.email;
  if (typeof claimed === "string" && claimed) {
    // ID token: the claim says whether the email is verified.
    if (String(identity.claims?.email_verified) !== "true") fail("FORBIDDEN", UNVERIFIED);
    return claimed.toLowerCase();
  }

  const cached = emailCache.get(username);
  if (cached) return cached;

  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error("USER_POOL_ID is not configured");
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  const attribute = (name: string) => user.UserAttributes?.find((a) => a.Name === name)?.Value;
  const email = attribute("email")?.toLowerCase();
  if (!email) fail("FORBIDDEN", "Your account has no email address.");
  if (attribute("email_verified") !== "true") fail("FORBIDDEN", UNVERIFIED);
  emailCache.set(username, email);
  return email;
}

const UNVERIFIED = "Verify your email address before using TeamTask.";

/** Caller from the AppSync identity: Cognito username, email, roles (no group = VIEWER) and organisation. */
export async function getCaller(identity: unknown): Promise<Caller> {
  const cognitoIdentity = (identity ?? {}) as CognitoIdentityLike;
  const username = cognitoIdentity.username ?? cognitoIdentity.sub;
  if (!username) fail("FORBIDDEN", "Sign in to use this API.");

  const claimGroups = cognitoIdentity.claims?.["cognito:groups"];
  const groups = cognitoIdentity.groups ?? (Array.isArray(claimGroups) ? (claimGroups as string[]) : []);

  return { username, email: await emailFor(cognitoIdentity, username), roles: toRoles(groups), organisationId: organisationFromGroups(groups) };
}
