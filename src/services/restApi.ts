import "./amplifyConfig";
import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import { ApiError } from "./apiError";

/** The REST API (API Gateway, Cognito authorizer): assistant, career suggestions, agent activity. */
export const API_UNAVAILABLE = "API_UNAVAILABLE";

interface ApiOutputs {
  custom?: { teamtaskApi?: { url?: string } };
}

/** Base URL: amplify_outputs.json (custom.teamtaskApi.url), or VITE_API_URL to target another stage. */
export function restApiUrl(): string | null {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  const url = fromEnv || (outputs as ApiOutputs).custom?.teamtaskApi?.url;
  return url ? url.replace(/\/$/, "") : null;
}

/** fetch() with the user's Cognito ID token. Throws ApiError with a user-facing message on HTTP errors. */
export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = restApiUrl();
  if (!base) throw new ApiError("This feature isn't deployed in this environment yet.", API_UNAVAILABLE);
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken?.toString();
  if (!token) throw new ApiError("Your session has expired. Sign in again.", "HTTP_401");
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: token } });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await response.clone().json();
    } catch {
      /* not JSON */
    }
    const fallback =
      response.status === 429 ? "Too many requests. Try again later." : response.status === 401 ? "Your session has expired. Sign in again." : `The request failed (${response.status}).`;
    throw new ApiError(body.error?.message ?? fallback, `HTTP_${response.status}`);
  }
  return response;
}
