import "./amplifyConfig";
import { confirmSignIn, fetchAuthSession, signIn, signOut } from "aws-amplify/auth";
import type { SignInOutput } from "aws-amplify/auth";

/** Outcome of a sign-in step, reduced to what the UI needs to know. */
export type SignInResult = "SIGNED_IN" | "NEW_PASSWORD_REQUIRED" | "UNSUPPORTED_STEP";

export interface CurrentUserInfo {
  email: string | null;
  groups: string[];
}

function toResult({ isSignedIn, nextStep }: SignInOutput): SignInResult {
  if (isSignedIn) return "SIGNED_IN";
  if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") return "NEW_PASSWORD_REQUIRED";
  // MFA and other challenges are not enabled on this user pool.
  console.warn("[authService] Unsupported sign-in step", nextStep.signInStep);
  return "UNSUPPORTED_STEP";
}

/** Signs in with email + password. Throws Cognito errors (see utils/authErrors). */
export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  return toResult(await signIn({ username: email, password }));
}

/** Answers the first-login challenge for administrator-created accounts. */
export async function completeNewPassword(newPassword: string): Promise<SignInResult> {
  return toResult(await confirmSignIn({ challengeResponse: newPassword }));
}

export async function signOutUser(): Promise<void> {
  await signOut();
}

/** Email and Cognito groups of the signed-in user, read from the session tokens. */
export async function getCurrentUserInfo(): Promise<CurrentUserInfo> {
  const { tokens } = await fetchAuthSession();
  const email = tokens?.idToken?.payload.email;
  const groups = tokens?.accessToken.payload["cognito:groups"];
  return {
    email: typeof email === "string" ? email : null,
    groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === "string") : [],
  };
}
