import { ORPCError } from "@orpc/client";

/** A short, user-facing message for an oRPC, better-auth or network error. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ORPCError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

/** Whether the API answered with the given typed error code, e.g. `CONFLICT`. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof ORPCError && error.code === code;
}

const ACCESS_ERROR_CODES = new Set(["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"]);

/**
 * The resource is gone or no longer this user's to see. Unlike network or 5xx errors,
 * retrying will not help and cached copies must not stay on screen.
 */
export function isAccessError(error: unknown): boolean {
  return error instanceof ORPCError && ACCESS_ERROR_CODES.has(error.code);
}
