import type { Dispatch } from "@notifier/api/dispatch";
import type { PushSender } from "@notifier/api/push/fcm";
import type { Database } from "@notifier/db";
import type { RequestLogger } from "evlog";
import { describe, expect, it, vi } from "vitest";

import { backgroundRunner, createDispatch } from "../src/dispatch";
import { createScheduledHandler } from "../src/scheduled";

function requestLog() {
  return {
    getContext: () => ({ requestId: "req-1" }),
    set: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const MESSAGE = { id: "msg_1", projectId: "prj_1", project: "team", priority: 3 } as Parameters<
  Dispatch["messagePublished"]
>[0];

describe("createDispatch", () => {
  it("logs push as disabled once per request and schedules nothing without a sender", () => {
    const log = requestLog();
    const waitUntil = vi.fn();
    const dispatch = createDispatch({
      log: log as unknown as RequestLogger,
      db: {} as Database,
      waitUntil,
      push: { sender: null, disabledReason: "missing FCM_SERVICE_ACCOUNT" },
    });
    dispatch.messagePublished(MESSAGE);
    dispatch.messagePublished(MESSAGE);
    dispatch.messagesRead("ada", ["msg_1"]);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith("push disabled", {
      push: { disabled: "missing FCM_SERVICE_ACCOUNT" },
    });
  });

  it("runs fan-out in waitUntil, off the request log, never rejects and never logs error text", async () => {
    const consoleSpies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const log = requestLog();
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const sender: PushSender = { send: vi.fn() };
    // A database that fails, so the background task throws.
    const db = {
      select: () => {
        throw new Error("SENTINEL_DB_TEXT");
      },
    } as unknown as Database;
    const dispatch = createDispatch({
      log: log as unknown as RequestLogger,
      db,
      waitUntil,
      push: { sender },
    });
    dispatch.messagePublished(MESSAGE);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    expect(sender.send).not.toHaveBeenCalled();
    expect(log.set).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    const logged = JSON.stringify(consoleSpies.map((spy) => spy.mock.calls));
    expect(logged).toContain("push task failed");
    expect(logged).not.toContain("SENTINEL_DB_TEXT");
    vi.restoreAllMocks();
  });
});

describe("backgroundRunner", () => {
  it("gives each task its own logger tagged with the operation and parent request id", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const run = backgroundRunner(requestLog() as unknown as RequestLogger, waitUntil);
    let context: Record<string, unknown> = {};
    run("push.message", async (log) => {
      log.set({ push: { sent: 1 } });
      context = (log as unknown as RequestLogger).getContext();
    });
    await waitUntil.mock.calls[0]?.[0];
    expect(context).toMatchObject({
      operation: "push.message",
      parentRequestId: "req-1",
      push: { sent: 1 },
    });
    vi.restoreAllMocks();
  });
});

describe("createScheduledHandler", () => {
  it("runs the cleanup with the trigger's scheduled time", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = {} as Database;
    const cleanup = vi.fn(async () => ({
      messages: 2,
      invites: 0,
      devices: 1,
      done: true,
    }));
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const scheduledTime = Date.UTC(2026, 10, 20, 13);
    createScheduledHandler({ getDb: () => db, cleanup })(
      { cron: "0 * * * *", scheduledTime },
      { waitUntil },
    );
    await waitUntil.mock.calls[0]?.[0];
    expect(cleanup).toHaveBeenCalledWith(db, { now: new Date(scheduledTime) });
    vi.restoreAllMocks();
  });

  it("rejects the waitUntil promise when the cleanup fails, so the run shows as failed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    createScheduledHandler({
      getDb: () => ({}) as Database,
      cleanup: async () => {
        throw new Error("d1 down");
      },
    })({ cron: "0 * * * *", scheduledTime: 0 }, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow("d1 down");
    vi.restoreAllMocks();
  });
});
