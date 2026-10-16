interface GraphQLErrorLike {
  message: string;
  errorType?: string;
}

/** Codes sent by the task Lambda functions as "[CODE] message". */
export const SERVER_CODES = ["FORBIDDEN", "VALIDATION", "DEPENDENCY", "NOT_FOUND", "INTERNAL"] as const;
export type ServerCode = (typeof SERVER_CODES)[number];

const CODED_MESSAGE = /^\[([A-Z_]+)\]\s*([\s\S]*)$/;

/** Error thrown by services when the Data API rejects a request. Keeps the error code. */
export class ApiError extends Error {
  /** AppSync errorType (e.g. "Unauthorized") or a server code (e.g. "DEPENDENCY"). */
  readonly errorType: string | undefined;

  constructor(message: string, errorType?: string) {
    super(message);
    this.name = "ApiError";
    this.errorType = errorType;
  }

  /** A server rule rejection whose message is meant for the user. */
  get isServerRule(): boolean {
    return (SERVER_CODES as readonly (string | undefined)[]).includes(this.errorType) && this.errorType !== "INTERNAL";
  }

  static from(errors: readonly GraphQLErrorLike[] | undefined, fallback: string): ApiError {
    const first = errors?.[0];
    if (!first) return new ApiError(fallback);
    const coded = CODED_MESSAGE.exec(first.message);
    if (coded) return new ApiError(coded[2], coded[1]);
    return new ApiError(errors?.map((e) => e.message).join("; ") || fallback, first.errorType);
  }
}
