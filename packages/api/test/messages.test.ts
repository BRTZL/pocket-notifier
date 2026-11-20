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
  noopDispatch,
  seedUser,
  type TestUser,
} from "./helpers";

const UNREADABLE_TAGS = /unreadable tags_json/u;

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
    ({ id: teamId } = await owner.projects.create({ name: "team" }));
    ({ id: opsId } = await owner.projects.create({ name: "ops" }));
    await owner.members.add({ projectId: teamId, email: bob.email, role: "publisher" });
    await owner.members.add({ projectId: opsId, email: bob.email, role: "subscriber" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** Publishes `count` messages to `project` as Ada, each in its own millisecond. Oldest first. */
  async function publishMany(project: string, count: number) {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        (await clientFor(testDb.db, ada).messages.publish({ project, body: `${project}-${index}` }))
          .id,
      );
      await nextMillisecond();
    }
    return ids;
  }

  describe("list and get", () => {
    it("is an inbox over every project the caller is a member of, newest first", async () => {
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

      const onlyOps = await bobClient.messages.list({ projectId: opsId });
      expect(onlyOps.items.map((item) => item.project)).toEqual(["ops", "ops"]);

      // Cid is in no project.
      expect((await clientFor(testDb.db, cid).messages.list({})).items).toEqual([]);
      await expect(
        clientFor(testDb.db, cid).messages.list({ projectId: opsId }),
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
        project: "team",
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

    it("includes only the caller's own responses, on every message of a page", async () => {
      const adaClient = clientFor(testDb.db, ada);
      const bobClient = clientFor(testDb.db, bob);
      const actions = [
        { type: "reply" as const, key: "ok", label: "OK" },
        { type: "reply" as const, key: "note", label: "Note", input: true },
      ];
      const { id: ask } = await adaClient.messages.publish({ project: "team", actions });
      await nextMillisecond();
      const { id: other } = await adaClient.messages.publish({ project: "team", actions });
      await nextMillisecond();
      const { id: quiet } = await adaClient.messages.publish({ project: "team", body: "no reply" });

      await bobClient.responses.create({ messageId: ask, actionKey: "ok" });
      await nextMillisecond();
      await bobClient.responses.create({ messageId: ask, actionKey: "note", text: "Later" });
      await bobClient.responses.create({ messageId: other, actionKey: "note", text: "Done" });
      // Ada answers too; Bob must never see her response.
      await adaClient.responses.create({ messageId: ask, actionKey: "note", text: "Ada's" });

      const bobInbox = await bobClient.messages.list({});
      const byId = new Map(bobInbox.items.map((item) => [item.id, item.myResponses]));
      expect(byId.get(ask)).toEqual([
        { actionKey: "ok", kind: "ack", text: null, createdAt: expect.any(String) },
        { actionKey: "note", kind: "text", text: "Later", createdAt: expect.any(String) },
      ]);
      expect(byId.get(other)).toEqual([
        { actionKey: "note", kind: "text", text: "Done", createdAt: expect.any(String) },
      ]);
      expect(byId.get(quiet)).toEqual([]);

      expect((await bobClient.messages.get({ id: ask })).myResponses).toHaveLength(2);
      expect((await adaClient.messages.get({ id: ask })).myResponses).toEqual([
        { actionKey: "note", kind: "text", text: "Ada's", createdAt: expect.any(String) },
      ]);
      const adaInbox = await adaClient.messages.list({});
      expect(adaInbox.items.find((item) => item.id === other)?.myResponses).toEqual([]);
    });
  });

  describe("markRead", () => {
    it("ignores expired messages in both forms", async () => {
      const [expired = "", live = ""] = await publishMany("team", 2);
      await testDb.db
        .update(message)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(message.id, expired));
      const bobClient = clientFor(testDb.db, bob);
      expect(await bobClient.messages.markRead({ ids: [expired] })).toEqual({ updated: 0 });
      expect(await bobClient.messages.markRead({ upTo: live })).toEqual({ updated: 1 });
      const rows = await testDb.db.select().from(messageRead).where(eq(messageRead.userId, bob.id));
      expect(rows.map((row) => row.messageId)).toEqual([live]);
    });

    it("marks ids the caller can see and counts only new rows", async () => {
      const [teamMsg] = await publishMany("team", 1);
      const owner = clientFor(testDb.db, ada);
      const { id: privateId } = await owner.projects.create({ name: "private" });
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

    it("marks everything up to a message, optionally in one project", async () => {
      const team = await publishMany("team", 3);
      const ops = await publishMany("ops", 2);
      const later = await publishMany("team", 1);
      const bobClient = clientFor(testDb.db, bob);

      expect(await bobClient.messages.markRead({ upTo: ops[1] ?? "", projectId: teamId })).toEqual({
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
    it("sets expiresAt from the project's retention", async () => {
      const owner = clientFor(testDb.db, ada);
      await owner.projects.create({ name: "short", retentionDays: 7 });
      const out = await owner.messages.publish({ project: "short" });
      expect(Date.parse(out.expiresAt) - Date.parse(out.createdAt)).toBe(7 * 86_400_000);
      expect((await owner.messages.get({ id: out.id })).expiresAt).toBe(out.expiresAt);
    });

    it("lets owners and publishers publish, and dispatches the stored message", async () => {
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      const bobClient = clientFor(testDb.db, bob, { ...noopDispatch, messagePublished });
      const out = await bobClient.messages.publish({ project: "team", title: "test" });
      expect(out).toMatchObject({ project: "team" });
      const stored = await bobClient.messages.get({ id: out.id });
      expect(stored).toMatchObject({ priority: 3, publishedBy: { id: bob.id } });
      const { read: _read, myResponses: _myResponses, ...published } = stored;
      expect(messagePublished).toHaveBeenCalledTimes(1);
      expect(messagePublished).toHaveBeenCalledWith(published);

      const [row] = await testDb.db.select().from(message).where(eq(message.id, out.id));
      expect(row?.tokenId).toBeNull();
    });

    it("is FORBIDDEN for subscribers and NOT_FOUND for non-members", async () => {
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      await expect(
        clientFor(testDb.db, bob, { ...noopDispatch, messagePublished }).messages.publish({
          project: "ops",
        }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));
      await expect(
        clientFor(testDb.db, cid, { ...noopDispatch, messagePublished }).messages.publish({
          project: "team",
        }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      await expect(
        clientFor(testDb.db, ada, { ...noopDispatch, messagePublished }).messages.publish({
          project: "missing",
        }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      expect(messagePublished).not.toHaveBeenCalled();
    });

    it("applies the shared publish rules", async () => {
      await expect(
        clientFor(testDb.db, ada).messages.publish({
          project: "team",
          attachmentId: "att_01jd8x7q3n1p5s8u0w2y4a6c8e",
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
    });
  });

  describe("stored JSON", () => {
    // A plain Error, not an ORPCError: the handlers answer it with a 500.
    it("fails loudly on a row that does not parse", async () => {
      const [id = ""] = await publishMany("team", 1);
      const bobClient = clientFor(testDb.db, bob);
      await testDb.db.update(message).set({ tagsJson: "not json" }).where(eq(message.id, id));
      await expect(bobClient.messages.get({ id })).rejects.toThrow(UNREADABLE_TAGS);
      await expect(bobClient.messages.list({})).rejects.toThrow(UNREADABLE_TAGS);

      // Valid JSON that breaks the contract schema fails the same way.
      await testDb.db.update(message).set({ tagsJson: '["two words"]' }).where(eq(message.id, id));
      await expect(bobClient.messages.get({ id })).rejects.toThrow(UNREADABLE_TAGS);
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
