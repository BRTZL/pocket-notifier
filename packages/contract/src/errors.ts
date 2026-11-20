import { z } from "zod";

/**
 * Typed errors shared by both contracts. Validation failures use oRPC's built-in
 * `BAD_REQUEST` (400) with the zod issues in `data`.
 */
export const ERRORS = {
  UNAUTHORIZED: {
    status: 401,
    message: "Missing or invalid credentials",
  },
  FORBIDDEN: {
    status: 403,
    message: "Not allowed for this topic or resource",
  },
  NOT_FOUND: {
    status: 404,
    message: "Not found",
  },
  CONFLICT: {
    status: 409,
    message: "Already exists",
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: "Payload too large",
    data: z.object({ maxBytes: z.number().int() }),
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: "Rate limit exceeded",
    data: z.object({ retryAfterSeconds: z.number().int().min(1) }),
  },
} as const;
