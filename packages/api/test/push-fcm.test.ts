import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFcmSender, createSendBudget } from "../src/push/fcm";
import { clearTokenCache } from "../src/push/oauth";
import { fcmError, mockFetch, testServiceAccount, UNREGISTERED } from "./push-helpers";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DATA = { v: "1", kind: "dismiss", ids: "msg_1" };

function options(priority: "HIGH" | "NORMAL" = "NORMAL", limit = 40) {
  return { priority, budget: createSendBudget(limit) };
}

beforeEach(() => {
  clearTokenCache();
});

async function setup(mockOptions: Parameters<typeof mockFetch>[0]) {
  const { credential } = await testServiceAccount();
  const mock = mockFetch(mockOptions);
  const sleep = vi.fn(async (_ms: number) => undefined);
  const sender = createFcmSender(credential, { fetch: mock.fetch, now: () => NOW, sleep });
  return { mock, sleep, sender };
}

describe("createFcmSender", () => {
  it("posts a data-only message with the Android priority, a one-day TTL and a timeout", async () => {
    const { mock, sender } = await setup({});
    await expect(sender.send("device-token", DATA, options("HIGH"))).resolves.toEqual({
      status: "sent",
    });
    const [send] = mock.sendRequests();
    expect(send?.url).toBe("https://fcm.googleapis.com/v1/projects/notifier-test/messages:send");
    expect(new Headers(send?.init?.headers).get("Authorization")).toBe("Bearer access-1");
    expect(send?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(send?.init?.body))).toEqual({
      message: { token: "device-token", data: DATA, android: { priority: "HIGH", ttl: "86400s" } },
    });
  });

  it("reuses the access token across sends", async () => {
    const { mock, sender } = await setup({});
    await sender.send("a", DATA, options());
    await sender.send("b", DATA, options());
    expect(mock.tokenRequests()).toHaveLength(1);
    expect(mock.sendRequests()).toHaveLength(2);
  });

  it("reports UNREGISTERED and token INVALID_ARGUMENT as dead, without retrying", async () => {
    const unregistered = await setup({ sends: [UNREGISTERED] });
    await expect(unregistered.sender.send("t", DATA, options())).resolves.toEqual({
      status: "dead",
      reason: "dead_token",
      httpStatus: 404,
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
    await expect(badToken.sender.send("t", DATA, options())).resolves.toMatchObject({
      status: "dead",
    });
  });

  it("does not treat a bare 404 or a payload INVALID_ARGUMENT as a dead token", async () => {
    const notFound = await setup({ sends: [() => new Response("Not Found", { status: 404 })] });
    await expect(notFound.sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "unknown",
      httpStatus: 404,
    });

    const badPayload = await setup({
      sends: [
        fcmError(400, {
          status: "INVALID_ARGUMENT",
          message: "Invalid value at 'message.data[0].value'",
          details: [{ fieldViolations: [{ field: "message.data[0].value" }] }],
        }),
      ],
    });
    await expect(badPayload.sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "unknown",
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
    await expect(sender.send("t", DATA, options())).resolves.toEqual({ status: "sent" });
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
    await expect(sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "rate_limited",
      httpStatus: 429,
    });
    expect(mock.sendRequests()).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it("never resends after a transport error: delivery is unknown", async () => {
    const { mock, sleep, sender } = await setup({
      sends: [
        () => {
          throw new TypeError("connection reset after request was written");
        },
        () => Response.json({ name: "ok" }),
      ],
    });
    await expect(sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "unknown",
    });
    expect(mock.sendRequests()).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports a timeout without resending", async () => {
    const { mock, sender } = await setup({
      sends: [
        () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        },
      ],
    });
    await expect(sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "timeout",
    });
    expect(mock.sendRequests()).toHaveLength(1);
  });

  it("gets a new access token once when FCM answers 401", async () => {
    const { mock, sender } = await setup({
      sends: [fcmError(401, { status: "UNAUTHENTICATED" }), () => Response.json({ name: "ok" })],
    });
    await expect(sender.send("t", DATA, options())).resolves.toEqual({ status: "sent" });
    expect(mock.tokenRequests()).toHaveLength(2);
    const auth = mock.sendRequests().map((r) => new Headers(r.init?.headers).get("Authorization"));
    expect(auth).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("shares one token refresh when concurrent sends all get 401", async () => {
    let sends = -1;
    const { mock, sender } = await setup({
      sends: [
        () => {
          sends += sends < 0 ? 0 : 1;
          return sends >= 1 && sends <= 3
            ? fcmError(401, { status: "UNAUTHENTICATED" })()
            : Response.json({ name: "ok" });
        },
      ],
    });
    // Warm the cache so all three start with the same token.
    await sender.send("warm", DATA, options());
    sends = 0;
    const results = await Promise.all(["a", "b", "c"].map((t) => sender.send(t, DATA, options())));
    expect(results).toEqual([{ status: "sent" }, { status: "sent" }, { status: "sent" }]);
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it("fails with reason auth, without sending, when the token exchange fails", async () => {
    const { mock, sender } = await setup({ tokens: [() => new Response("nope", { status: 500 })] });
    await expect(sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "auth",
      httpStatus: 500,
    });
    expect(mock.sendRequests()).toHaveLength(0);
  });

  it("does not retry other client errors", async () => {
    const { mock, sender } = await setup({
      sends: [
        fcmError(403, {
          status: "PERMISSION_DENIED",
          details: [{ errorCode: "SENDER_ID_MISMATCH" }],
        }),
      ],
    });
    await expect(sender.send("t", DATA, options())).resolves.toEqual({
      status: "failed",
      reason: "auth",
      httpStatus: 403,
    });
    expect(mock.sendRequests()).toHaveLength(1);
  });

  it("counts retries against the shared budget and skips when it is used up", async () => {
    const { mock, sender } = await setup({ sends: [fcmError(503, { status: "UNAVAILABLE" })] });
    const budget = createSendBudget(4);
    await expect(sender.send("a", DATA, { priority: "NORMAL", budget })).resolves.toMatchObject({
      status: "failed",
      reason: "server_error",
    });
    // One request left: the second send makes it, then has no budget to retry.
    await expect(sender.send("b", DATA, { priority: "NORMAL", budget })).resolves.toMatchObject({
      status: "failed",
    });
    await expect(sender.send("c", DATA, { priority: "NORMAL", budget })).resolves.toEqual({
      status: "skipped",
      reason: "budget",
    });
    expect(mock.sendRequests()).toHaveLength(4);
  });
});
