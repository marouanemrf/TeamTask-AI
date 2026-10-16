import { ApiError } from "../services/apiError";
import { AGENT_UNAVAILABLE } from "../services/agentService";
import { AVATAR_UPLOAD_FAILED, DUPLICATE_EMAIL, DUPLICATE_USERNAME } from "../services/teamService";

/** User-facing message for a Data API failure. */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    // Task API rejections (FORBIDDEN, VALIDATION, DEPENDENCY, NOT_FOUND) carry a user-facing message.
    if (err.isServerRule) return err.message;
    // AI assistant: not deployed yet, or a REST error carrying a user-facing message.
    if (err.errorType === AGENT_UNAVAILABLE || err.errorType?.startsWith("HTTP_")) return err.message;
    if (err.errorType === DUPLICATE_EMAIL) return "A member with this email already exists in the organisation.";
    if (err.errorType === DUPLICATE_USERNAME) return "This username is already taken in the organisation.";
    if (err.errorType === AVATAR_UPLOAD_FAILED) return "The profile picture could not be uploaded. Please try again.";
    if (err.errorType === "Unauthorized") return "Action denied: ADMIN or PROJECT_MANAGER role required.";
    if (err.errorType?.includes("Validation")) return "Some values are invalid. Please check the form.";
  }
  if (err instanceof TypeError || (err instanceof Error && err.name === "NetworkError")) {
    return "Unable to reach the server. Check your connection.";
  }
  return "Something went wrong. Please try again.";
}
