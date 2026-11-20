import { z } from "zod";

import type { ServiceAccount } from "./service-account";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Google caps assertion lifetimes at one hour. */
const JWT_LIFETIME_S = 3600;
/** A cached access token is replaced this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Data messages older than this are dropped by FCM instead of delivered late. */
const MESSAGE_TTL = "86400s";

const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
/** `Retry-After` is honored up to this; pushes run in `waitUntil`, which has little time. */
const MAX_RETRY_DELAY_MS = 2000;

const PEM_ARMOR = /-----(?:BEGIN|END) PRIVATE KEY-----/gu;
const PEM_NOISE = /\\n|\s/gu;
const REGISTRATION_TOKEN = /registration token/iu;
const DIGITS_ONLY = /^\d+$/u;
const BASE64_PADDING = /[=]+$/u;

export type PushPriority = "HIGH" | "NORMAL";

export type SendResult =
  | { status: "sent" }
  /** The token is no longer valid; delete the device. */
  | { status: "dead"; reason: string }
  | { status: "failed"; reason: string; httpStatus?: number };

/** Sends one data-only push to one device token. Never throws. */
export type PushSender = {
  send: (
    token: string,
    data: Record<string, string>,
    options: { priority: PushPriority },
  ) => Promise<SendResult>;
};

export type FcmDeps = {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  maxAttempts: number;
};

type CachedToken = { value: string; expiresAt: number };

/**
 * Access tokens per service account (`client_email`), shared by every request the
 * isolate serves. The promise is cached so concurrent sends share one exchange.
 */
const tokenCache = new Map<string, Promise<CachedToken>>();

/** Empties the access-token cache. For tests. */
export function clearTokenCache() {
  tokenCache.clear();
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(BASE64_PADDING, "");
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/** The DER bytes of a PKCS #8 PEM key, tolerating literal `\n` escapes. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(PEM_ARMOR, "").replace(PEM_NOISE, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** An RS256 JWT assertion for the OAuth token exchange, signed with WebCrypto. */
export async function signServiceAccountJwt(
  account: ServiceAccount,
  nowMs: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const iat = Math.floor(nowMs / 1000);
  const header = base64UrlFromJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlFromJson({
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + JWT_LIFETIME_S,
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

async function exchangeToken(account: ServiceAccount, deps: FcmDeps): Promise<CachedToken> {
  const requestedAt = deps.now();
  const assertion = await signServiceAccountJwt(account, requestedAt);
  const response = await deps.fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${response.status}`);
  }
  const parsed = TokenResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new Error("OAuth token exchange returned no access token");
  }
  return {
    value: parsed.data.access_token,
    expiresAt: requestedAt + parsed.data.expires_in * 1000,
  };
}

/** A cached access token, or a new one when there is none or it expires within 60 s. */
export async function getAccessToken(
  account: ServiceAccount,
  deps: FcmDeps,
  options: { refresh?: boolean } = {},
): Promise<string> {
  const key = account.client_email;
  const pending = tokenCache.get(key);
  if (pending && !options.refresh) {
    const cached = await pending.catch(() => null);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > deps.now()) {
      return cached.value;
    }
  }
  const fresh = exchangeToken(account, deps);
  tokenCache.set(key, fresh);
  fresh.catch(() => {
    if (tokenCache.get(key) === fresh) {
      tokenCache.delete(key);
    }
  });
  return (await fresh).value;
}

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

function errorCodeOf(error: FcmError): string | undefined {
  return error.details?.find((detail) => detail.errorCode)?.errorCode;
}

/**
 * Whether FCM says the token itself is unusable. Deliberately narrow: a bare 404 (for
 * example from a wrong project id) is a configuration problem, not a dead device.
 */
export function isDeadTokenError(httpStatus: number, error: FcmError): boolean {
  const errorCode = errorCodeOf(error);
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

function isRetryable(httpStatus: number) {
  return httpStatus === 429 || httpStatus >= 500;
}

/** Delay before the next attempt: `Retry-After` when given, else exponential, capped. */
function retryDelay(response: Response | null, attempt: number, nowMs: number): number {
  const header = response?.headers.get("Retry-After");
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

function failureReason(error: FcmError, httpStatus: number) {
  return errorCodeOf(error) ?? error.status ?? `HTTP ${httpStatus}`;
}

function failed(error: unknown, fallback: string): SendResult {
  return { status: "failed", reason: error instanceof Error ? error.message : fallback };
}

/** What one attempt produced, and whether another attempt may help. */
type Attempt = {
  result: SendResult;
  /** Set when the attempt may be retried after this many milliseconds. */
  retryAfterMs?: number;
  /** FCM rejected the access token: get a new one and try again. */
  refreshToken?: boolean;
};

async function attemptSend(
  account: ServiceAccount,
  deps: FcmDeps,
  request: { url: string; body: string; attempt: number },
): Promise<Attempt> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, deps);
  } catch (authError) {
    return { result: failed(authError, "auth") };
  }
  let response: Response;
  try {
    response = await deps.fetch(request.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: request.body,
    });
  } catch (networkError) {
    return {
      result: failed(networkError, "network"),
      retryAfterMs: retryDelay(null, request.attempt, deps.now()),
    };
  }
  if (response.ok) {
    return { result: { status: "sent" } };
  }
  const error = await readFcmError(response);
  const reason = failureReason(error, response.status);
  if (isDeadTokenError(response.status, error)) {
    return { result: { status: "dead", reason } };
  }
  const result: SendResult = { status: "failed", reason, httpStatus: response.status };
  if (response.status === 401) {
    return { result, refreshToken: true };
  }
  if (isRetryable(response.status)) {
    return { result, retryAfterMs: retryDelay(response, request.attempt, deps.now()) };
  }
  return { result };
}

/** An FCM HTTP v1 sender for one Firebase project. */
export function createFcmSender(
  account: ServiceAccount,
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
    ...overrides,
  };
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;

  return {
    send: async (token, data, { priority }) => {
      const body = JSON.stringify({
        message: { token, data, android: { priority, ttl: MESSAGE_TTL } },
      });
      let refreshed = false;
      let last: SendResult = { status: "failed", reason: "not attempted" };
      for (let attempt = 1; attempt <= deps.maxAttempts; attempt += 1) {
        // Attempts depend on each other: each one runs only if the previous failed.
        // biome-ignore lint/performance/noAwaitInLoops: sequential retries
        const outcome = await attemptSend(account, deps, { url, body, attempt });
        last = outcome.result;
        if (outcome.refreshToken && !refreshed) {
          // The cached token was revoked or expired early: get a new one and try again.
          refreshed = true;
          await getAccessToken(account, deps, { refresh: true }).catch(() => undefined);
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
