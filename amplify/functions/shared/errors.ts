/** Error codes returned to the client in the message as "[CODE] message". */
export type ErrorCode = "FORBIDDEN" | "VALIDATION" | "DEPENDENCY" | "NOT_FOUND" | "INTERNAL";

/** An expected rejection (bad input, missing permission, business rule). Logged as a warning. */
export class TaskApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "TaskApiError";
    this.code = code;
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new TaskApiError(code, message);
}

/** The message AppSync sends back to the client. */
export function toClientMessage(code: ErrorCode, message: string): string {
  return `[${code}] ${message}`;
}
