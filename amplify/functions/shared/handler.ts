import { getCaller } from "./auth";
import type { Caller } from "./auth";
import { TaskApiError, fail, toClientMessage } from "./errors";

interface MutationEvent<Args> {
  arguments: Args;
  identity?: unknown;
}

/**
 * Common wrapper for every task mutation:
 * - resolves the caller and rejects VIEWER (and callers with no group) up front;
 * - expected rejections (TaskApiError) are logged to CloudWatch with console.warn and returned as
 *   "[CODE] message" — they are NOT written to the TaskEvent audit log;
 * - anything else is logged with console.error and returned as a generic INTERNAL error.
 */
export async function runMutation<Args, Result>(
  name: string,
  event: MutationEvent<Args>,
  body: (caller: Caller, args: Args) => Promise<Result>,
): Promise<Result> {
  let caller: Caller | undefined;
  try {
    caller = await getCaller(event.identity);
    // Roles are additive: VIEWER must not cancel another granted role.
    if (!caller.roles.some((role) => role !== "VIEWER")) fail("FORBIDDEN", "Your role doesn't allow changing tasks.");
    return await body(caller, event.arguments);
  } catch (err) {
    if (err instanceof TaskApiError) {
      console.warn(JSON.stringify({ fn: name, outcome: "REJECTED", code: err.code, message: err.message, caller: caller?.email, args: event.arguments }));
      throw new Error(toClientMessage(err.code, err.message));
    }
    console.error(JSON.stringify({ fn: name, outcome: "ERROR", caller: caller?.email, error: err instanceof Error ? err.stack : String(err) }));
    throw new Error(toClientMessage("INTERNAL", "Something went wrong on the server. Please try again."));
  }
}
