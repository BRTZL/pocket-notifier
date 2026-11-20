import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTokenCache,
  createFcmSender,
  FCM_SCOPE,
  GOOGLE_TOKEN_URL,
  getAccessToken,
  signServiceAccountJwt,
} from "../src/push/fcm";
import { parseServiceAccount } from "../src/push/service-account";
import { fcmError, mockFetch, testServiceAccount, UNREGISTERED } from "./push-helpers";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DATA = { v: "1", kind: "dismiss", ids: "msg_1" };

function fromBase64Url(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
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

describe("signServiceAccountJwt", () => {
  it("signs an RS256 assertion for the FCM scope that verifies with the public key", async () => {
    const { account, publicKey } = await testServiceAccount();
    const jwt = await signServiceAccountJwt(account, NOW);
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

  it("accepts a key whose newlines are literal \\n escapes", async () => {
    const { account } = await testServiceAccount();
    const escaped = { ...account, private_key: account.private_key.replaceAll("\n", "\\n") };
    await expect(signServiceAccountJwt(escaped, NOW)).resolves.toContain(".");
  });
});

describe("getAccessToken", () => {
  it("exchanges a jwt-bearer assertion and caches the token until 60 s before expiry", async () => {
    const { account } = await testServiceAccount();
    const mock = mockFetch({});
    let now = NOW;
    const deps = {
      fetch: mock.fetch,
      now: () => now,
      sleep: async () => undefined,
      maxAttempts: 3,
    };

    expect(await getAccessToken(account, deps)).toBe("access-1");
    const [exchange] = mock.tokenRequests();
    const form = new URLSearchParams(String(exchange?.init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    now = NOW + 3_600_000 - 61_000;
    expect(await getAccessToken(account, deps)).toBe("access-1");
    expect(mock.tokenRequests()).toHaveLength(1);

    now = NOW + 3_600_000 - 59_000;
    expect(await getAccessToken(account, deps)).toBe("access-2");
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("shares one exchange between concurrent callers and keys the cache by client_email", async () => {
    const { account } = await testServiceAccount("a@test.iam.gserviceaccount.com");
    const other = { ...account, client_email: "b@test.iam.gserviceaccount.com" };
    const mock = mockFetch({});
    const deps = {
      fetch: mock.fetch,
      now: () => NOW,
      sleep: async () => undefined,
      maxAttempts: 3,
    };

    const tokens = await Promise.all([
      getAccessToken(account, deps),
      getAccessToken(account, deps),
      getAccessToken(account, deps),
    ]);
    expect(new Set(tokens).size).toBe(1);
    expect(mock.tokenRequests()).toHaveLength(1);
    await getAccessToken(other, deps);
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("does not cache a failed exchange", async () => {
    const { account } = await testServiceAccount();
    const mock = mockFetch({
      tokens: [
        () => Response.json({ error: "invalid_grant" }, { status: 400 }),
        () => Response.json({ access_token: "ok", expires_in: 3600 }),
      ],
    });
    const deps = {
      fetch: mock.fetch,
      now: () => NOW,
      sleep: async () => undefined,
      maxAttempts: 3,
    };
    await expect(getAccessToken(account, deps)).rejects.toThrow("HTTP 400");
    await expect(getAccessToken(account, deps)).resolves.toBe("ok");
  });
});

describe("createFcmSender", () => {
  async function setup(options: Parameters<typeof mockFetch>[0]) {
    const { account } = await testServiceAccount();
    const mock = mockFetch(options);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const sender = createFcmSender(account, { fetch: mock.fetch, now: () => NOW, sleep });
    return { account, mock, sleep, sender };
  }

  it("posts a data-only message with the Android priority and a one-day TTL", async () => {
    const { mock, sender } = await setup({});
    await expect(sender.send("device-token", DATA, { priority: "HIGH" })).resolves.toEqual({
      status: "sent",
    });
    const [send] = mock.sendRequests();
    expect(send?.url).toBe("https://fcm.googleapis.com/v1/projects/notifier-test/messages:send");
    expect(new Headers(send?.init?.headers).get("Authorization")).toBe("Bearer access-1");
    expect(JSON.parse(String(send?.init?.body))).toEqual({
      message: { token: "device-token", data: DATA, android: { priority: "HIGH", ttl: "86400s" } },
    });
  });

  it("reuses the access token across sends", async () => {
    const { mock, sender } = await setup({});
    await sender.send("a", DATA, { priority: "NORMAL" });
    await sender.send("b", DATA, { priority: "NORMAL" });
    expect(mock.tokenRequests()).toHaveLength(1);
    expect(mock.sendRequests()).toHaveLength(2);
  });

  it("reports UNREGISTERED and token INVALID_ARGUMENT as dead, without retrying", async () => {
    const unregistered = await setup({ sends: [UNREGISTERED] });
    await expect(unregistered.sender.send("t", DATA, { priority: "HIGH" })).resolves.toEqual({
      status: "dead",
      reason: "UNREGISTERED",
    });
    expect(unregistered.mock.sendRequests()).toHaveLength(1);

    const badToken = await setup({
      sends: [
        fcmError(400, {
          status: "INVALID_ARGUMENT",
          message: "The registration token is not a valid FCM registration token",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                { field: "message.token", description: "Invalid registration token" },
              ],
            },
          ],
        }),
      ],
    });
    await expect(badToken.sender.send("t", DATA, { priority: "HIGH" })).resolves.toMatchObject({
      status: "dead",
    });
  });

  it("does not treat a bare 404 or a payload INVALID_ARGUMENT as a dead token", async () => {
    const notFound = await setup({ sends: [() => new Response("Not Found", { status: 404 })] });
    await expect(notFound.sender.send("t", DATA, { priority: "HIGH" })).resolves.toEqual({
      status: "failed",
      reason: "HTTP 404",
      httpStatus: 404,
    });

    const badPayload = await setup({
      sends: [
        fcmError(400, {
          status: "INVALID_ARGUMENT",
          message: "Invalid value at 'message.data[0].value'",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [{ field: "message.data[0].value" }],
            },
          ],
        }),
      ],
    });
    await expect(badPayload.sender.send("t", DATA, { priority: "HIGH" })).resolves.toMatchObject({
      status: "failed",
      httpStatus: 400,
    });
    expect(badPayload.mock.sendRequests()).toHaveLength(1);
  });

  it("retries 5xx with backoff and succeeds", async () => {
    const { mock, sleep, sender } = await setup({
      sends: [
        fcmError(503, { status: "UNAVAILABLE" }),
        () => new Response("oops", { status: 500 }),
        () => Response.json({ name: "ok" }),
      ],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toEqual({
      status: "sent",
    });
    expect(mock.sendRequests()).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400]);
  });

  it("gives up after 3 attempts and honors Retry-After up to a cap", async () => {
    const { mock, sleep, sender } = await setup({
      sends: [
        fcmError(429, { status: "RESOURCE_EXHAUSTED" }, { "Retry-After": "1" }),
        fcmError(429, { status: "RESOURCE_EXHAUSTED" }, { "Retry-After": "120" }),
        fcmError(429, { status: "RESOURCE_EXHAUSTED" }),
      ],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toEqual({
      status: "failed",
      reason: "RESOURCE_EXHAUSTED",
      httpStatus: 429,
    });
    expect(mock.sendRequests()).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it("retries network errors", async () => {
    const { sender } = await setup({
      sends: [
        () => {
          throw new TypeError("network down");
        },
        () => Response.json({ name: "ok" }),
      ],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toEqual({
      status: "sent",
    });
  });

  it("gets a new access token once when FCM answers 401", async () => {
    const { mock, sender } = await setup({
      sends: [fcmError(401, { status: "UNAUTHENTICATED" }), () => Response.json({ name: "ok" })],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toEqual({
      status: "sent",
    });
    expect(mock.tokenRequests()).toHaveLength(2);
    const auth = mock.sendRequests().map((r) => new Headers(r.init?.headers).get("Authorization"));
    expect(auth).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("returns a failure instead of throwing when the token exchange fails", async () => {
    const { mock, sender } = await setup({
      tokens: [() => new Response("nope", { status: 500 })],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toMatchObject({
      status: "failed",
    });
    expect(mock.sendRequests()).toHaveLength(0);
  });

  it("logs other client errors as failures without retrying", async () => {
    const { mock, sender } = await setup({
      sends: [
        fcmError(403, {
          status: "PERMISSION_DENIED",
          details: [{ errorCode: "SENDER_ID_MISMATCH" }],
        }),
      ],
    });
    await expect(sender.send("t", DATA, { priority: "NORMAL" })).resolves.toEqual({
      status: "failed",
      reason: "SENDER_ID_MISMATCH",
      httpStatus: 403,
    });
    expect(mock.sendRequests()).toHaveLength(1);
  });
});
