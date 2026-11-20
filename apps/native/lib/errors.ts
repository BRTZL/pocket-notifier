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
