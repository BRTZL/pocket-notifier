import { z } from "zod";

import type { ServiceAccount } from "./service-account";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Google caps assertion lifetimes at one hour. */
const JWT_LIFETIME_S = 3600;
/** A cached access token is replaced this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const PEM_ARMOR = /-----(?:BEGIN|END) PRIVATE KEY-----/gu;
const PEM_NOISE = /\\n|\s/gu;
const BASE64_PADDING = /[=]+$/u;

/** A service account whose private key has been imported and checked. */
export type Credential = {
  projectId: string;
  clientEmail: string;
  key: CryptoKey;
  /** SHA-256 of the key's DER bytes, hex. Identifies the key without exposing it. */
  fingerprint: string;
};

export type OAuthDeps = {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Per-request timeout for the token exchange. */
  timeoutMs: number;
};

/** An access token and when it expires (epoch milliseconds). */
export type AccessToken = { value: string; expiresAt: number };

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

/**
 * Imports the service account's PKCS #8 RSA key for RS256 signing. `null` when the key
 * is not a usable RSA private key, so a broken secret disables push up front instead of
 * failing every send.
 */
export async function prepareCredential(account: ServiceAccount): Promise<Credential | null> {
  try {
    const der = pemToDer(account.private_key);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
    const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return {
      projectId: account.project_id,
      clientEmail: account.client_email,
      key,
      fingerprint,
    };
  } catch {
    return null;
  }
}

/** An RS256 JWT assertion for the OAuth token exchange, signed with WebCrypto. */
export async function signServiceAccountJwt(credential: Credential, nowMs: number) {
  const iat = Math.floor(nowMs / 1000);
  const header = base64UrlFromJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlFromJson({
    iss: credential.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + JWT_LIFETIME_S,
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    credential.key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** Thrown when no access token could be obtained. Carries no response text. */
export class OAuthError extends Error {
  readonly httpStatus?: number;

  constructor(httpStatus?: number) {
    super(
      httpStatus
        ? `OAuth token exchange failed (HTTP ${httpStatus})`
        : "OAuth token exchange failed",
    );
    this.name = "OAuthError";
    this.httpStatus = httpStatus;
  }
}

async function exchangeToken(credential: Credential, deps: OAuthDeps): Promise<AccessToken> {
  const requestedAt = deps.now();
  const assertion = await signServiceAccountJwt(credential, requestedAt);
  let response: Response;
  try {
    response = await deps.fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch {
    throw new OAuthError();
  }
  if (!response.ok) {
    throw new OAuthError(response.status);
  }
  const parsed = TokenResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new OAuthError(response.status);
  }
  return {
    value: parsed.data.access_token,
    expiresAt: requestedAt + parsed.data.expires_in * 1000,
  };
}

type CacheEntry = { token?: AccessToken; inflight?: Promise<AccessToken> };

/**
 * Access tokens per private key (its fingerprint), shared by every request the isolate
 * serves. A rotated key with the same `client_email` gets its own token.
 */
const tokenCache = new Map<string, CacheEntry>();

/** Empties the access-token cache. For tests. */
export function clearTokenCache() {
  tokenCache.clear();
}

/**
 * A cached access token, or a new one when there is none or it expires within 60 s.
 * Concurrent callers share one exchange.
 */
export function getAccessToken(credential: Credential, deps: OAuthDeps): Promise<AccessToken> {
  const key = credential.fingerprint;
  let entry = tokenCache.get(key);
  if (!entry) {
    entry = {};
    tokenCache.set(key, entry);
  }
  const { token } = entry;
  if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > deps.now()) {
    return Promise.resolve(token);
  }
  if (entry.inflight !== undefined) {
    return entry.inflight;
  }
  // No `await` between the check above and setting `inflight`, so concurrent callers
  // always see the pending exchange.
  const current = entry;
  const inflight = exchangeToken(credential, deps).then(
    (fresh) => {
      current.token = fresh;
      current.inflight = undefined;
      return fresh;
    },
    (error: unknown) => {
      current.inflight = undefined;
      throw error;
    },
  );
  current.inflight = inflight;
  return inflight;
}

/**
 * Forgets `rejected` after FCM refused it. Compare-and-clear: a token that already
 * replaced it is kept, so concurrent 401s lead to one exchange, not one each.
 */
export function invalidateAccessToken(credential: Credential, rejected: AccessToken) {
  const entry = tokenCache.get(credential.fingerprint);
  if (entry?.token?.value === rejected.value) {
    entry.token = undefined;
  }
}
