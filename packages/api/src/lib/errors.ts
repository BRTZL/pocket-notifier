import { ERRORS } from "@notifier/contract/errors";
import { ORPCError } from "@orpc/server";

const UNIQUE_VIOLATION = /UNIQUE constraint failed/u;

type AppErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";

/**
 * Builds an `ORPCError` that matches the contract's error map (same code, status and
 * default message), so oRPC marks it as a defined, typed error for the client.
 */
export function appError(code: AppErrorCode, message?: string) {
  const { status, message: defaultMessage } = ERRORS[code];
  return new ORPCError(code, { status, message: message ?? defaultMessage });
}

/** True when a D1 write failed on a UNIQUE or PRIMARY KEY constraint (both report "UNIQUE constraint failed"). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (UNIQUE_VIOLATION.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
