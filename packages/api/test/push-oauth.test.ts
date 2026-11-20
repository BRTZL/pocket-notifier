import { beforeEach, describe, expect, it } from "vitest";

import {
  clearTokenCache,
  FCM_SCOPE,
  GOOGLE_TOKEN_URL,
  getAccessToken,
  invalidateAccessToken,
  prepareCredential,
  signServiceAccountJwt,
} from "../src/push/oauth";
import { parseServiceAccount } from "../src/push/service-account";
import { mockFetch, testServiceAccount } from "./push-helpers";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const SHA256_HEX = /^[0-9a-f]{64}$/u;

function fromBase64Url(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
}

/** A promise with its resolve function, to hold a mocked response back. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  clearTokenCache();
});

describe("parseServiceAccount", () => {
  it("treats an unset or blank secret as missing", () => {
    expect(parseServiceAccount(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(parseServiceAccount("  ")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects JSON that is not a service-account key", () => {
    expect(parseServiceAccount("{not json")).toEqual({ ok: false, reason: "invalid" });
    expect(parseServiceAccount(JSON.stringify({ project_id: "x" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reads one-line JSON, and JSON whose \\n escapes were expanded by a .env loader", async () => {
    const { account } = await testServiceAccount();
    const oneLine = JSON.stringify({ type: "service_account", ...account });
    expect(parseServiceAccount(oneLine)).toEqual({ ok: true, account });
    const expanded = oneLine.replaceAll("\\n", "\n");
    expect(parseServiceAccount(expanded)).toEqual({ ok: true, account });
  });
});

describe("prepareCredential", () => {
  it("imports the PKCS #8 key and fingerprints it", async () => {
    const { account } = await testServiceAccount();
    const credential = await prepareCredential(account);
    expect(credential).toMatchObject({
      projectId: "notifier-test",
      clientEmail: account.client_email,
    });
    expect(credential?.fingerprint).toMatch(SHA256_HEX);
  });

  it("accepts a key whose newlines are literal \\n escapes", async () => {
    const { account } = await testServiceAccount();
    const escaped = { ...account, private_key: account.private_key.replaceAll("\n", "\\n") };
    await expect(prepareCredential(escaped)).resolves.not.toBeNull();
  });

  it("returns null for a key that does not import", async () => {
    const broken = {
      project_id: "p",
      client_email: "e",
      private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
    };
    await expect(prepareCredential(broken)).resolves.toBeNull();
    const notBase64 = {
      ...broken,
      private_key: "-----BEGIN PRIVATE KEY-----\n!!\n-----END PRIVATE KEY-----",
    };
    await expect(prepareCredential(notBase64)).resolves.toBeNull();
  });
});

describe("signServiceAccountJwt", () => {
  it("signs an RS256 assertion for the FCM scope that verifies with the public key", async () => {
    const { credential, account, publicKey } = await testServiceAccount();
    const jwt = await signServiceAccountJwt(credential, NOW);
    const [header = "", claims = "", signature = ""] = jwt.split(".");

    expect(decodeJson(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const iat = Math.floor(NOW / 1000);
    expect(decodeJson(claims)).toEqual({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});

describe("getAccessToken", () => {
  it("exchanges a jwt-bearer assertion and caches the token until 60 s before expiry", async () => {
    const { credential } = await testServiceAccount();
    const mock = mockFetch({});
    let now = NOW;
    const deps = { fetch: mock.fetch, now: () => now, timeoutMs: 8000 };

    expect((await getAccessToken(credential, deps)).value).toBe("access-1");
    const [exchange] = mock.tokenRequests();
    const form = new URLSearchParams(String(exchange?.init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
    expect(exchange?.init?.signal).toBeInstanceOf(AbortSignal);

    now = NOW + 3_600_000 - 61_000;
    expect((await getAccessToken(credential, deps)).value).toBe("access-1");
    expect(mock.tokenRequests()).toHaveLength(1);

    now = NOW + 3_600_000 - 59_000;
    expect((await getAccessToken(credential, deps)).value).toBe("access-2");
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("shares one exchange when the token expires under concurrent callers", async () => {
    const { credential } = await testServiceAccount();
    const gate = deferred<void>();
    let calls = 0;
    const mock = mockFetch({
      tokens: [
        async () => {
          calls += 1;
          if (calls > 1) {
            await gate.promise;
          }
          return Response.json({ access_token: `access-${calls}`, expires_in: 3600 });
        },
      ],
    });
    let now = NOW;
    const deps = { fetch: mock.fetch, now: () => now, timeoutMs: 8000 };
    await getAccessToken(credential, deps);

    now = NOW + 3_600_000;
    const pending = Promise.all([1, 2, 3, 4].map(() => getAccessToken(credential, deps)));
    gate.resolve();
    const tokens = await pending;
    expect(tokens.map((token) => token.value)).toEqual([
      "access-2",
      "access-2",
      "access-2",
      "access-2",
    ]);
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("invalidates only the rejected token, so concurrent 401s lead to one exchange", async () => {
    const { credential } = await testServiceAccount();
    const mock = mockFetch({});
    const deps = { fetch: mock.fetch, now: () => NOW, timeoutMs: 8000 };
    const first = await getAccessToken(credential, deps);

    // Two sends both saw `first` rejected. The first invalidation clears it and a new
    // token is fetched; the second invalidation must not throw that new token away.
    invalidateAccessToken(credential, first);
    const second = await getAccessToken(credential, deps);
    invalidateAccessToken(credential, first);
    const third = await getAccessToken(credential, deps);
    expect(second.value).toBe("access-2");
    expect(third.value).toBe("access-2");
    expect(mock.tokenRequests()).toHaveLength(2);

    // Concurrent: both invalidate before either refetches.
    invalidateAccessToken(credential, third);
    invalidateAccessToken(credential, third);
    const both = await Promise.all([
      getAccessToken(credential, deps),
      getAccessToken(credential, deps),
    ]);
    expect(both.map((token) => token.value)).toEqual(["access-3", "access-3"]);
    expect(mock.tokenRequests()).toHaveLength(3);
  });

  it("keys the cache by private key: a rotated key with the same email gets a new token", async () => {
    const { credential } = await testServiceAccount("same@test.iam.gserviceaccount.com");
    const { credential: rotated } = await testServiceAccount("same@test.iam.gserviceaccount.com");
    const mock = mockFetch({});
    const deps = { fetch: mock.fetch, now: () => NOW, timeoutMs: 8000 };
    await getAccessToken(credential, deps);
    await getAccessToken(credential, deps);
    expect(mock.tokenRequests()).toHaveLength(1);
    expect((await getAccessToken(rotated, deps)).value).toBe("access-2");
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("does not cache a failed exchange", async () => {
    const { credential } = await testServiceAccount();
    const mock = mockFetch({
      tokens: [
        () => Response.json({ error: "invalid_grant" }, { status: 400 }),
        () => Response.json({ access_token: "ok", expires_in: 3600 }),
      ],
    });
    const deps = { fetch: mock.fetch, now: () => NOW, timeoutMs: 8000 };
    await expect(getAccessToken(credential, deps)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(getAccessToken(credential, deps)).resolves.toMatchObject({ value: "ok" });
  });
});
