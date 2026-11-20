import { device } from "@notifier/db/schema/notifier";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { createPublicHandler } from "../src/public/handler";
import { createPushDispatch, type PushLog, type PushTask } from "../src/push/dispatch";
import type { PushSender, SendResult } from "../src/push/fcm";
import { toDismissData, toPushData } from "../src/push/payload";
import { createTestDb, type TestDb } from "./db";
import { clientFor, nextMillisecond, noopDispatch, seedUser, type TestUser } from "./helpers";

function fakeLog(): PushLog {
  return { set: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A fake FCM sender: every token is `sent` unless listed in `results`. */
function fakeSender(results: Record<string, SendResult["status"]> = {}) {
  const send = vi.fn<PushSender["send"]>(async (token) => {
    const status = results[token] ?? "sent";
    return status === "sent" ? { status } : { status, reason: "test" };
  });
  return { send } satisfies PushSender;
}

describe("push dispatch", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let cid: TestUser;
  let dan: TestUser;
  let eve: TestUser;
  let teamId: string;
  let tasks: Promise<void>[];
  let requestLog: PushLog;

  beforeEach(async () => {
    testDb = await createTestDb();
    [ada, bob, cid, dan, eve] = (await Promise.all(
      ["ada", "bob", "cid", "dan", "eve"].map((id) => seedUser(testDb.db, id)),
    )) as [TestUser, TestUser, TestUser, TestUser, TestUser];
    const owner = clientFor(testDb.db, ada);
    ({ id: teamId } = await owner.topics.create({ name: "team" }));
    await owner.members.add({ topicId: teamId, email: bob.email, role: "publisher" });
    await owner.members.add({ topicId: teamId, email: cid.email, role: "subscriber" });
    await owner.members.add({ topicId: teamId, email: dan.email, role: "subscriber" });
    // Cid muted the topic; Dan unsubscribed; Eve is not a member.
    await clientFor(testDb.db, cid).topics.setSubscription({
      topicId: teamId,
      subscribed: true,
      muted: true,
    });
    await clientFor(testDb.db, dan).topics.setSubscription({ topicId: teamId, subscribed: false });

    for (const [user, token, platform] of [
      [ada, "ada-phone", "android"],
      [ada, "ada-tablet", "android"],
      [bob, "bob-phone", "android"],
      [bob, "bob-iphone", "ios"],
      [cid, "cid-phone", "android"],
      [dan, "dan-phone", "android"],
      [eve, "eve-phone", "android"],
    ] as const) {
      await clientFor(testDb.db, user).devices.register({
        pushToken: token,
        name: token,
        platform,
      });
    }
    tasks = [];
    requestLog = fakeLog();
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  function pushDispatch(sender: PushSender | null) {
    const taskLogs: PushLog[] = [];
    const dispatch = createPushDispatch({
      db: testDb.db,
      sender,
      disabledReason: sender ? undefined : "missing FCM_SERVICE_ACCOUNT",
      log: requestLog,
      runInBackground: (_label: string, task: PushTask) => {
        const log = fakeLog();
        taskLogs.push(log);
        tasks.push(task(log));
      },
    });
    return { dispatch, taskLogs };
  }

  async function settle() {
    await Promise.all(tasks);
  }

  async function remainingTokens() {
    const rows = await testDb.db.select({ token: device.pushToken }).from(device);
    return rows.map((row) => row.token).sort();
  }

  describe("on publish", () => {
    it("sends to members who are subscribed and not muted, publisher included, Android only", async () => {
      const sender = fakeSender();
      const { dispatch } = pushDispatch(sender);
      const out = await clientFor(testDb.db, ada, dispatch).messages.publish({
        topic: "team",
        title: "deploy",
        body: "done",
        priority: 5,
      });
      await settle();

      const tokens = sender.send.mock.calls.map(([token]) => token).sort();
      expect(tokens).toEqual(["ada-phone", "ada-tablet", "bob-phone"]);
      const published = await clientFor(testDb.db, ada).messages.get({ id: out.id });
      const { read: _read, myResponses: _responses, ...message } = published;
      for (const [, data, options] of sender.send.mock.calls) {
        expect(data).toEqual(toPushData(message));
        expect(options).toEqual({ priority: "HIGH" });
      }
    });

    it("uses NORMAL FCM priority for message priority 1-3", async () => {
      const sender = fakeSender();
      const { dispatch } = pushDispatch(sender);
      await clientFor(testDb.db, bob, dispatch).messages.publish({ topic: "team", priority: 3 });
      await settle();
      expect(sender.send).toHaveBeenCalled();
      expect(sender.send.mock.calls.every(([, , options]) => options.priority === "NORMAL")).toBe(
        true,
      );
    });

    it("deletes devices FCM reports as dead and keeps the rest", async () => {
      const sender = fakeSender({ "bob-phone": "dead", "ada-tablet": "failed" });
      const { dispatch, taskLogs } = pushDispatch(sender);
      await clientFor(testDb.db, ada, dispatch).messages.publish({ topic: "team" });
      await settle();
      expect(await remainingTokens()).toEqual([
        "ada-phone",
        "ada-tablet",
        "bob-iphone",
        "cid-phone",
        "dan-phone",
        "eve-phone",
      ]);
      expect(taskLogs[0]?.set).toHaveBeenLastCalledWith({
        push: { recipients: 3, truncated: false, sent: 1, dead: 1, failed: 1 },
      });
      expect(taskLogs[0]?.warn).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the topic has no recipients", async () => {
      const sender = fakeSender();
      const { dispatch } = pushDispatch(sender);
      const owner = clientFor(testDb.db, eve, dispatch);
      await owner.topics.create({ name: "solo" });
      await testDb.db.delete(device);
      await owner.messages.publish({ topic: "solo" });
      await settle();
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe("on read", () => {
    async function publishMany(count: number) {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const out = await clientFor(testDb.db, bob).messages.publish({
          topic: "team",
          body: `m${index}`,
          conversation: { id: index % 2 === 0 ? "even" : "odd" },
        });
        ids.push(out.id);
        await nextMillisecond();
      }
      return ids;
    }

    it("passes only newly marked ids to dispatch, for every markRead form", async () => {
      const [m0 = "", m1 = "", m2 = "", m3 = ""] = await publishMany(4);
      const messagesRead = vi.fn<Dispatch["messagesRead"]>();
      const client = clientFor(testDb.db, ada, { ...noopDispatch, messagesRead });

      await client.messages.markRead({ ids: [m0, m1] });
      expect(messagesRead).toHaveBeenLastCalledWith(ada.id, [m0, m1]);

      await client.messages.markRead({ ids: [m0, m1] });
      expect(messagesRead).toHaveBeenCalledTimes(1);

      await client.messages.markRead({ conversation: { topicId: teamId, key: "c:even" } });
      expect(messagesRead).toHaveBeenLastCalledWith(ada.id, [m2]);

      await client.messages.markRead({ upTo: m3, topicId: teamId });
      expect(messagesRead).toHaveBeenLastCalledWith(ada.id, [m3]);
      expect(messagesRead).toHaveBeenCalledTimes(3);
    });

    it("sends dismiss to all of the reader's Android devices", async () => {
      const ids = await publishMany(2);
      const sender = fakeSender();
      const { dispatch } = pushDispatch(sender);
      await clientFor(testDb.db, bob, dispatch).messages.markRead({ ids });
      await settle();

      const [dismiss] = toDismissData(ids);
      expect(sender.send.mock.calls).toEqual([["bob-phone", dismiss, { priority: "NORMAL" }]]);
    });

    it("sends nothing when no message was newly read", async () => {
      const ids = await publishMany(1);
      const sender = fakeSender();
      await clientFor(testDb.db, bob).messages.markRead({ ids });
      const { dispatch } = pushDispatch(sender);
      await clientFor(testDb.db, bob, dispatch).messages.markRead({ ids });
      await settle();
      expect(tasks).toHaveLength(0);
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe("without FCM_SERVICE_ACCOUNT", () => {
    it("still publishes with 201, schedules nothing and logs once per request at debug", async () => {
      const { dispatch } = pushDispatch(null);
      const { secret } = await clientFor(testDb.db, ada).tokens.create({
        name: "ci",
        scope: { kind: "all" },
      });
      const handler = createPublicHandler();
      const publish = () =>
        handler.handle(
          new Request("http://api.test/v1/topics/team/messages", {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ body: "hello" }),
          }),
          { context: { db: testDb.db, authorization: `Bearer ${secret}`, dispatch } },
        );

      expect((await publish()).response?.status).toBe(201);
      expect((await publish()).response?.status).toBe(201);
      dispatch.messagesRead(ada.id, ["msg_x"]);
      expect(tasks).toHaveLength(0);
      expect(requestLog.debug).toHaveBeenCalledTimes(1);
      expect(requestLog.debug).toHaveBeenCalledWith("push disabled", {
        push: { disabled: "missing FCM_SERVICE_ACCOUNT" },
      });
    });
  });
});
