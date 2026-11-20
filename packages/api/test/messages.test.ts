import { message, messageRead } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { createTestDb, type TestDb } from "./db";
import {
  clientFor,
  codeError,
  definedError,
  nextMillisecond,
  seedUser,
  type TestUser,
} from "./helpers";

describe("app messages", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let cid: TestUser;
  let teamId: string;
  let opsId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    cid = await seedUser(testDb.db, "cid");
    const owner = clientFor(testDb.db, ada);
    ({ id: teamId } = await owner.topics.create({ name: "team" }));
    ({ id: opsId } = await owner.topics.create({ name: "ops" }));
    await owner.members.add({ topicId: teamId, email: bob.email, role: "publisher" });
    await owner.members.add({ topicId: opsId, email: bob.email, role: "subscriber" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** Publishes `count` messages to `topic` as Ada, each in its own millisecond. Oldest first. */
  async function publishMany(topic: string, count: number) {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        (await clientFor(testDb.db, ada).messages.publish({ topic, body: `${topic}-${index}` })).id,
      );
      await nextMillisecond();
    }
    return ids;
  }

  describe("list and get", () => {
    it("is an inbox over every topic the caller is a member of, newest first", async () => {
      const team = await publishMany("team", 2);
      const ops = await publishMany("ops", 2);
      const bobClient = clientFor(testDb.db, bob);

      const inbox = await bobClient.messages.list({});
      expect(inbox.items.map((item) => item.id)).toEqual([...team, ...ops].reverse());
      expect(inbox.items.every((item) => item.read === false)).toBe(true);
      expect(inbox.nextCursor).toBeNull();

      const page = await bobClient.messages.list({ limit: 3 });
      expect(page.items).toHaveLength(3);
      const rest = await bobClient.messages.list({ limit: 3, cursor: page.nextCursor ?? "" });
      expect(rest.items.map((item) => item.id)).toEqual([team[0]]);
      expect(rest.nextCursor).toBeNull();

      const onlyOps = await bobClient.messages.list({ topicId: opsId });
      expect(onlyOps.items.map((item) => item.topic)).toEqual(["ops", "ops"]);

      // Cid is in no topic.
      expect((await clientFor(testDb.db, cid).messages.list({})).items).toEqual([]);
      await expect(
        clientFor(testDb.db, cid).messages.list({ topicId: opsId }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
    });

    it("filters unread, flags read and hides expired messages", async () => {
      const [first, second, third] = await publishMany("team", 3);
      const bobClient = clientFor(testDb.db, bob);
      await bobClient.messages.markRead({ ids: [second ?? ""] });
      await testDb.db
        .update(message)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(message.id, first ?? ""));

      const all = await bobClient.messages.list({});
      expect(all.items.map((item) => [item.id, item.read])).toEqual([
        [third, false],
        [second, true],
      ]);
      const unread = await bobClient.messages.list({ unreadOnly: true });
      expect(unread.items.map((item) => item.id)).toEqual([third]);

      expect(await bobClient.messages.get({ id: second ?? "" })).toMatchObject({
        id: second,
        read: true,
        topic: "team",
        publishedBy: { id: ada.id },
      });
      // Read state is per user.
      expect((await clientFor(testDb.db, ada).messages.get({ id: second ?? "" })).read).toBe(false);
      await expect(bobClient.messages.get({ id: first ?? "" })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      await expect(
        clientFor(testDb.db, cid).messages.get({ id: third ?? "" }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
    });
  });

  describe("markRead", () => {
    it("marks ids the caller can see and counts only new rows", async () => {
      const [teamMsg] = await publishMany("team", 1);
      const owner = clientFor(testDb.db, ada);
      const { id: privateId } = await owner.topics.create({ name: "private" });
      const [privateMsg] = await publishMany("private", 1);
      expect(privateId).toEqual(expect.any(String));

      const bobClient = clientFor(testDb.db, bob);
      const ids = [teamMsg ?? "", privateMsg ?? "", "msg_01jd8x5k2m9q7r4t6v8w0y3z5a"];
      expect(await bobClient.messages.markRead({ ids })).toEqual({ updated: 1 });
      expect(await bobClient.messages.markRead({ ids })).toEqual({ updated: 0 });
      const rows = await testDb.db.select().from(messageRead).where(eq(messageRead.userId, bob.id));
      expect(rows.map((row) => row.messageId)).toEqual([teamMsg]);
    });

    it("accepts 100 ids in one call", async () => {
      const ids = Array.from(
        { length: 100 },
        (_, index) => `msg_01jd8x5k2m9q7r4t6v8w0y${String(index).padStart(4, "0")}`,
      );
      await expect(clientFor(testDb.db, bob).messages.markRead({ ids })).resolves.toEqual({
        updated: 0,
      });
    });

    it("marks everything up to a message, optionally in one topic", async () => {
      const team = await publishMany("team", 3);
      const ops = await publishMany("ops", 2);
      const later = await publishMany("team", 1);
      const bobClient = clientFor(testDb.db, bob);

      expect(await bobClient.messages.markRead({ upTo: ops[1] ?? "", topicId: teamId })).toEqual({
        updated: 3,
      });
      expect(await bobClient.messages.markRead({ upTo: ops[0] ?? "" })).toEqual({ updated: 1 });
      const unread = await bobClient.messages.list({ unreadOnly: true });
      expect(unread.items.map((item) => item.id)).toEqual([later[0], ops[1]]);
      expect(team).toHaveLength(3);

      expect(await bobClient.messages.markRead({ upTo: later[0] ?? "" })).toEqual({ updated: 2 });
      expect((await bobClient.messages.list({ unreadOnly: true })).items).toEqual([]);
    });
  });

  describe("publish", () => {
    it("lets owners and publishers publish, and dispatches the stored message", async () => {
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      const bobClient = clientFor(testDb.db, bob, { messagePublished });
      const out = await bobClient.messages.publish({ topic: "team", title: "test" });
      expect(out).toMatchObject({ topic: "team" });
      const stored = await bobClient.messages.get({ id: out.id });
      expect(stored).toMatchObject({ priority: 3, publishedBy: { id: bob.id } });
      const { read: _read, ...published } = stored;
      expect(messagePublished).toHaveBeenCalledTimes(1);
      expect(messagePublished).toHaveBeenCalledWith(published);

      const [row] = await testDb.db.select().from(message).where(eq(message.id, out.id));
      expect(row?.tokenId).toBeNull();
    });

    it("is FORBIDDEN for subscribers and NOT_FOUND for non-members", async () => {
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      await expect(
        clientFor(testDb.db, bob, { messagePublished }).messages.publish({ topic: "ops" }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));
      await expect(
        clientFor(testDb.db, cid, { messagePublished }).messages.publish({ topic: "team" }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      await expect(
        clientFor(testDb.db, ada, { messagePublished }).messages.publish({ topic: "missing" }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      expect(messagePublished).not.toHaveBeenCalled();
    });

    it("applies the shared publish rules", async () => {
      await expect(
        clientFor(testDb.db, ada).messages.publish({
          topic: "team",
          attachmentId: "att_01jd8x7q3n1p5s8u0w2y4a6c8e",
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
    });
  });

  describe("delete", () => {
    it("is owner only", async () => {
      const [id = ""] = await publishMany("team", 1);
      await expect(clientFor(testDb.db, bob).messages.delete({ id })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );
      await expect(clientFor(testDb.db, cid).messages.delete({ id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      await expect(clientFor(testDb.db, ada).messages.delete({ id })).resolves.toEqual({
        ok: true,
      });
      await expect(clientFor(testDb.db, ada).messages.get({ id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      await expect(clientFor(testDb.db, ada).messages.delete({ id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
    });
  });
});
