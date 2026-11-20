import { z } from "zod";

import {
  type AccessToken,
  type Credential,
  getAccessToken,
  invalidateAccessToken,
  OAuthError,
} from "./oauth";

/** Data messages older than this are dropped by FCM instead of delivered late. */
const MESSAGE_TTL = "86400s";

const DEFAULT_MAX_ATTEMPTS = 3;
/** Per FCM or OAuth request; pushes run in `waitUntil`, which has little time. */
const DEFAULT_TIMEOUT_MS = 8000;
const BACKOFF_BASE_MS = 200;
/** `Retry-After` is honored up to this. */
const MAX_RETRY_DELAY_MS = 2000;

const REGISTRATION_TOKEN = /registration token/iu;
const DIGITS_ONLY = /^\d+$/u;

export type PushPriority = "HIGH" | "NORMAL";

/**
 * Why a push did not go out. Only these codes (and a numeric HTTP status) are ever
 * logged: never response text, tokens, keys or payloads.
 */
export type PushFailureReason = "rate_limited" | "server_error" | "timeout" | "auth" | "unknown";

export type SendResult =
  | { status: "sent" }
  /** The token is no longer valid; delete the device. */
  | { status: "dead"; reason: "dead_token"; httpStatus: number }
  | { status: "failed"; reason: PushFailureReason; httpStatus?: number }
  /** Not attempted: the invocation's send budget was used up. */
  | { status: "skipped"; reason: "budget" };

/** FCM requests one invocation may still make, retries included. Shared by its sends. */
export type SendBudget = { take: () => boolean };

export function createSendBudget(limit: number): SendBudget {
  let remaining = limit;
  return {
    take: () => {
      if (remaining <= 0) {
        return false;
      }
      remaining -= 1;
      return true;
    },
  };
}

/** Sends one data-only push to one device token. Never throws. */
export type PushSender = {
  send: (
    token: string,
    data: Record<string, string>,
    options: { priority: PushPriority; budget: SendBudget },
  ) => Promise<SendResult>;
};

export type FcmDeps = {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  maxAttempts: number;
  timeoutMs: number;
};

const FcmErrorBody = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
      details: z
        .array(
          z.looseObject({
            errorCode: z.string().optional(),
            fieldViolations: z.array(z.looseObject({ field: z.string().optional() })).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
type FcmError = NonNullable<z.infer<typeof FcmErrorBody>["error"]>;

async function readFcmError(response: Response): Promise<FcmError> {
  const parsed = FcmErrorBody.safeParse(await response.json().catch(() => null));
  return (parsed.success && parsed.data.error) || {};
}

/**
 * Whether FCM says the token itself is unusable. Deliberately narrow: a bare 404 (for
 * example from a wrong project id) is a configuration problem, not a dead device.
 */
export function isDeadTokenError(httpStatus: number, error: FcmError): boolean {
  const errorCode = error.details?.find((detail) => detail.errorCode)?.errorCode;
  if (errorCode === "UNREGISTERED") {
    return true;
  }
  if (httpStatus !== 400) {
    return false;
  }
  if (error.status !== "INVALID_ARGUMENT" && errorCode !== "INVALID_ARGUMENT") {
    return false;
  }
  const tokenViolation = error.details?.some((detail) =>
    detail.fieldViolations?.some((violation) => violation.field === "message.token"),
  );
  return Boolean(tokenViolation) || REGISTRATION_TOKEN.test(error.message ?? "");
}

function reasonForStatus(httpStatus: number): Exclude<PushFailureReason, "timeout"> {
  if (httpStatus === 429) {
    return "rate_limited";
  }
  if (httpStatus >= 500) {
    return "server_error";
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return "auth";
  }
  return "unknown";
}

/** Delay before the next attempt: `Retry-After` when given, else exponential, capped. */
function retryDelay(response: Response, attempt: number, nowMs: number): number {
  const header = response.headers.get("Retry-After");
  let delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  if (header) {
    const trimmed = header.trim();
    if (DIGITS_ONLY.test(trimmed)) {
      delay = Number(trimmed) * 1000;
    } else {
      const at = Date.parse(trimmed);
      if (!Number.isNaN(at)) {
        delay = at - nowMs;
      }
    }
  }
  return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** What one attempt produced, and whether another attempt may help. */
type Attempt = {
  result: SendResult;
  /** Set when FCM explicitly asked to retry (429/5xx), after this many milliseconds. */
  retryAfterMs?: number;
  /** FCM rejected this access token. */
  rejectedToken?: AccessToken;
};

async function attemptSend(
  credential: Credential,
  deps: FcmDeps,
  request: { url: string; body: string; attempt: number },
): Promise<Attempt> {
  let accessToken: AccessToken;
  try {
    accessToken = await getAccessToken(credential, deps);
  } catch (authError) {
    const httpStatus = authError instanceof OAuthError ? authError.httpStatus : undefined;
    return { result: { status: "failed", reason: "auth", httpStatus } };
  }
  let response: Response;
  try {
    response = await deps.fetch(request.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.value}`,
        "Content-Type": "application/json",
      },
      body: request.body,
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (transportError) {
    // The request may have reached FCM, so delivery is unknown: never resend it, or the
    // phone could show the notification twice.
    return {
      result: { status: "failed", reason: isTimeout(transportError) ? "timeout" : "unknown" },
    };
  }
  if (response.ok) {
    return { result: { status: "sent" } };
  }
  const httpStatus = response.status;
  const error = await readFcmError(response);
  if (isDeadTokenError(httpStatus, error)) {
    return { result: { status: "dead", reason: "dead_token", httpStatus } };
  }
  const result: SendResult = { status: "failed", reason: reasonForStatus(httpStatus), httpStatus };
  if (httpStatus === 401) {
    return { result, rejectedToken: accessToken };
  }
  if (httpStatus === 429 || httpStatus >= 500) {
    return { result, retryAfterMs: retryDelay(response, request.attempt, deps.now()) };
  }
  return { result };
}

/** An FCM HTTP v1 sender for one Firebase project. */
export function createFcmSender(
  credential: Credential,
  overrides: Partial<FcmDeps> = {},
): PushSender {
  const deps: FcmDeps = {
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...overrides,
  };
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credential.projectId)}/messages:send`;

  return {
    send: async (token, data, { priority, budget }) => {
      const body = JSON.stringify({
        message: { token, data, android: { priority, ttl: MESSAGE_TTL } },
      });
      let refreshed = false;
      let last: SendResult = { status: "skipped", reason: "budget" };
      for (let attempt = 1; attempt <= deps.maxAttempts; attempt += 1) {
        if (!budget.take()) {
          return last;
        }
        // Attempts depend on each other: each one runs only if the previous failed.
        // biome-ignore lint/performance/noAwaitInLoops: sequential retries
        const outcome = await attemptSend(credential, deps, { url, body, attempt });
        last = outcome.result;
        if (outcome.rejectedToken && !refreshed) {
          // Revoked or expired early: drop that token so the next attempt gets a new one.
          refreshed = true;
          invalidateAccessToken(credential, outcome.rejectedToken);
        } else if (outcome.retryAfterMs === undefined || attempt === deps.maxAttempts) {
          return last;
        } else {
          await deps.sleep(outcome.retryAfterMs);
        }
      }
      return last;
    },
  };
}
