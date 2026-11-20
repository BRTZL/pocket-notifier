import type { PublishInput } from "@notifier/contract/message";
import { message } from "@notifier/db/schema/notifier";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { conversationsQuery, previewOf } from "../src/lib/conversations";
import { selectInbox } from "../src/lib/messages";
import { createTestDb, type TestDb } from "./db";
import {
  clientFor,
  codeError,
  definedError,
  nextMillisecond,
  seedUser,
  type TestUser,
} from "./helpers";

const CONVERSATION_KEY_MIGRATION = "20261120185331_conversation_key";
const SEARCH_MESSAGE_BY_TOPIC = /^SEARCH message USING INDEX message_topicId_\w+ \(topic_id=\?/u;
const SEARCH_MESSAGE_BY_ID = /^SEARCH message USING INDEX sqlite_autoindex_message_1 \(id=\?\)/u;
const SCAN_MESSAGE = /^SCAN message\b/u;

describe("conversations", () => {
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
    ({ id: teamId } = await owner.topics.create({ name: "team", displayName: "The Team" }));
    ({ id: opsId } = await owner.topics.create({ name: "ops" }));
    await owner.members.add({ topicId: teamId, email: bob.email, role: "publisher" });
    await owner.members.add({ topicId: opsId, email: bob.email, role: "subscriber" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** Publishes as Ada, then waits a millisecond so the next id sorts after this one. */
  async function publish(input: Omit<PublishInput, "topic"> & { topic: string }) {
    const { id } = await clientFor(testDb.db, ada).messages.publish(input);
    await nextMillisecond();
    return id;
  }

  async function queryPlan(query: { sql: string; params: unknown[] }) {
    const plan = await testDb.d1
      .prepare(`explain query plan ${query.sql}`)
      .bind(...query.params)
      .all<{ detail: string }>();
    return plan.results.map((row) => row.detail);
  }

  async function expire(ids: string[]) {
    await testDb.db
      .update(message)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(inArray(message.id, ids));
  }

  const alpha = { id: "alpha", title: "Alpha project" };

  describe("list", () => {
    it("groups by conversation within each topic", async () => {
      await publish({ topic: "team", body: "a1", conversation: alpha });
      await publish({ topic: "team", body: "b1", conversation: { id: "beta" } });
      await publish({ topic: "team", body: "plain" });
      const a2 = await publish({ topic: "team", body: "a2", conversation: alpha });
      // Same conversation id in another topic is a separate conversation.
      const opsAlpha = await publish({ topic: "ops", body: "ops-a", conversation: alpha });

      const { items, nextCursor } = await clientFor(testDb.db, bob).conversations.list({});
      expect(nextCursor).toBeNull();
      expect(items.map((item) => [item.topic, item.key, item.kind, item.lastMessage.body])).toEqual(
        [
          ["ops", "c:alpha", "conversation", "ops-a"],
          ["team", "c:alpha", "conversation", "a2"],
          ["team", `t:${teamId}`, "topic", "plain"],
          ["team", "c:beta", "conversation", "b1"],
        ],
      );
      expect(items[0]).toMatchObject({ topicId: opsId, lastMessage: { id: opsAlpha } });
      expect(items[1]).toMatchObject({ topicId: teamId, lastMessage: { id: a2 }, unreadCount: 2 });
    });

    it("falls back through conversation title, id, topic display name and name", async () => {
      await publish({ topic: "team", body: "x", conversation: { id: "untitled" } });
      await publish({ topic: "ops", body: "x" });
      await publish({ topic: "team", body: "x" });
      await publish({
        topic: "team",
        body: "x",
        conversation: { ...alpha, iconUrl: "https://example.com/alpha.png" },
      });

      const { items } = await clientFor(testDb.db, bob).conversations.list({});
      expect(items.map((item) => [item.key, item.title, item.iconUrl])).toEqual([
        ["c:alpha", "Alpha project", "https://example.com/alpha.png"],
        [`t:${teamId}`, "The Team", null],
        [`t:${opsId}`, "ops", null],
        ["c:untitled", "untitled", null],
      ]);
    });

    it("describes each conversation by its latest message", async () => {
      await publish({
        topic: "team",
        title: "old title",
        body: "old",
        conversation: { id: "alpha", title: "Old name" },
        sender: { id: "codex" },
      });
      const longBody = `line one\n\n   line two ${"x".repeat(200)}`;
      const latest = await publish({
        topic: "team",
        title: "Build failed",
        body: longBody,
        priority: 5,
        conversation: { id: "alpha", title: "New name" },
        sender: { id: "claude", name: "Claude" },
      });
      await publish({ topic: "team", body: "by id", sender: { id: "codex" } });
      await publish({ topic: "ops", body: "anonymous" });

      const { items } = await clientFor(testDb.db, bob).conversations.list({});
      const [ops, team, conversation] = items;
      expect(ops?.lastMessage.senderName).toBeNull();
      expect(team?.lastMessage.senderName).toBe("codex");
      expect(conversation).toMatchObject({
        key: "c:alpha",
        title: "New name",
        lastMessage: { id: latest, title: "Build failed", senderName: "Claude", priority: 5 },
      });
      const preview = conversation?.lastMessage.body ?? "";
      expect(preview).toHaveLength(140);
      expect(preview.startsWith("line one line two xxx")).toBe(true);
      expect(preview.endsWith("…")).toBe(true);
      const stored = await clientFor(testDb.db, bob).messages.get({ id: latest });
      expect(conversation?.lastMessage.createdAt).toBe(stored.createdAt);
    });

    it("orders by last message, newest first, and pages by its id", async () => {
      const first = await publish({ topic: "team", body: "1", conversation: { id: "one" } });
      await publish({ topic: "team", body: "2", conversation: { id: "two" } });
      await publish({ topic: "team", body: "3", conversation: { id: "three" } });
      const bobClient = clientFor(testDb.db, bob);

      const page = await bobClient.conversations.list({ limit: 2 });
      expect(page.items.map((item) => item.key)).toEqual(["c:three", "c:two"]);
      expect(page.nextCursor).toBe(page.items[1]?.lastMessage.id);
      const rest = await bobClient.conversations.list({ limit: 2, cursor: page.nextCursor ?? "" });
      expect(rest.items.map((item) => item.key)).toEqual(["c:one"]);
      expect(rest.items[0]?.lastMessage.id).toBe(first);
      expect(rest.nextCursor).toBeNull();

      // A new message moves its conversation to the top.
      await publish({ topic: "team", body: "1b", conversation: { id: "one" } });
      const reordered = await bobClient.conversations.list({});
      expect(reordered.items.map((item) => item.key)).toEqual(["c:one", "c:three", "c:two"]);

      await expect(bobClient.conversations.list({ cursor: "nope" })).rejects.toMatchObject(
        codeError("BAD_REQUEST"),
      );
    });

    it("counts the caller's unread messages and shows the topic's muted flag", async () => {
      const [a1, a2] = [
        await publish({ topic: "team", body: "a1", conversation: alpha }),
        await publish({ topic: "team", body: "a2", conversation: alpha }),
      ];
      await publish({ topic: "ops", body: "o1" });
      const bobClient = clientFor(testDb.db, bob);
      await bobClient.messages.markRead({ ids: [a1 ?? ""] });
      await bobClient.topics.setSubscription({ topicId: opsId, subscribed: true, muted: true });

      const { items } = await bobClient.conversations.list({});
      expect(items.map((item) => [item.key, item.unreadCount, item.muted])).toEqual([
        [`t:${opsId}`, 1, true],
        ["c:alpha", 1, false],
      ]);
      // Read state is per user.
      const adaItems = (await clientFor(testDb.db, ada).conversations.list({})).items;
      expect(adaItems.map((item) => item.unreadCount)).toEqual([1, 2]);

      await bobClient.messages.markRead({ ids: [a2 ?? ""] });
      const after = (await bobClient.conversations.list({})).items;
      expect(after.map((item) => item.unreadCount)).toEqual([1, 0]);
    });

    it("leaves out expired messages, and conversations with nothing else", async () => {
      const gone = await publish({ topic: "team", body: "gone", conversation: { id: "gone" } });
      const kept = await publish({ topic: "team", body: "kept", conversation: alpha });
      const expiredLatest = await publish({ topic: "team", body: "late", conversation: alpha });
      await expire([gone, expiredLatest]);

      const { items } = await clientFor(testDb.db, bob).conversations.list({});
      expect(items.map((item) => [item.key, item.lastMessage.id, item.unreadCount])).toEqual([
        ["c:alpha", kept, 1],
      ]);
    });

    it("only shows topics the caller is a member of", async () => {
      await publish({ topic: "team", body: "team", conversation: alpha });
      const owner = clientFor(testDb.db, ada);
      const { id: privateId } = await owner.topics.create({ name: "private" });
      await owner.members.add({ topicId: privateId, email: cid.email, role: "subscriber" });
      await publish({ topic: "private", body: "secret", conversation: alpha });

      const bobItems = (await clientFor(testDb.db, bob).conversations.list({})).items;
      expect(bobItems.map((item) => item.topic)).toEqual(["team"]);
      const cidItems = (await clientFor(testDb.db, cid).conversations.list({})).items;
      expect(cidItems.map((item) => [item.topic, item.lastMessage.body])).toEqual([
        ["private", "secret"],
      ]);
      await expect(clientFor(testDb.db, null).conversations.list({})).rejects.toMatchObject(
        definedError("UNAUTHORIZED"),
      );
    });

    it("reads messages per member topic, never a full scan of message", async () => {
      const query = conversationsQuery(testDb.db, { userId: bob.id, limit: 10 }).toSQL();
      const details = await queryPlan(query);
      expect(details).toContainEqual(expect.stringMatching(SEARCH_MESSAGE_BY_TOPIC));
      expect(details).toContainEqual(expect.stringMatching(SEARCH_MESSAGE_BY_ID));
      expect(details.filter((detail) => SCAN_MESSAGE.test(detail))).toEqual([]);
    });
  });

  describe("preview", () => {
    it("cuts at grapheme boundaries within 140 UTF-16 units, ellipsis included", () => {
      const ascii = "a".repeat(137);
      // The flag (4 units) would end at 141 > 139, so it is left out whole.
      expect(previewOf(`${ascii}🇹🇷xyz`)).toBe(`${ascii}…`);
      const fitsFlag = "a".repeat(135);
      expect(previewOf(`${fitsFlag}🇹🇷xyz`)).toBe(`${fitsFlag}🇹🇷…`);

      const family = "👨‍👩‍👧‍👦"; // 11 UTF-16 units, one grapheme
      const before = "b".repeat(130);
      const cutFamily = previewOf(`${before}${family}tail`);
      expect(cutFamily).toBe(`${before}…`);
      const keepFamily = previewOf(`${"b".repeat(128)}${family}tail`);
      expect(keepFamily).toBe(`${"b".repeat(128)}${family}…`);
      for (const preview of [cutFamily, keepFamily]) {
        expect(preview.length).toBeLessThanOrEqual(140);
      }
      expect(previewOf("short\n text")).toBe("short text");
    });
  });

  describe("messages.list by conversation", () => {
    it("walks the conversation index in id order", async () => {
      const query = selectInbox(testDb.db, bob.id, [
        eq(message.topicId, teamId),
        eq(message.conversationKey, "c:alpha"),
      ])
        .limit(51)
        .toSQL();
      const details = await queryPlan(query);
      expect(details).toContainEqual(
        "SEARCH message USING INDEX message_topicId_conversationKey_id_idx (topic_id=? AND conversation_key=?)",
      );
      expect(details.filter((detail) => detail.includes("TEMP B-TREE"))).toEqual([]);
    });

    it("returns only that conversation's messages, newest first", async () => {
      const a1 = await publish({ topic: "team", body: "a1", conversation: alpha });
      await publish({ topic: "team", body: "plain" });
      const a2 = await publish({ topic: "team", body: "a2", conversation: alpha });
      await publish({ topic: "ops", body: "ops-a", conversation: alpha });
      const bobClient = clientFor(testDb.db, bob);

      const thread = await bobClient.messages.list({
        conversation: { topicId: teamId, key: "c:alpha" },
      });
      expect(thread.items.map((item) => item.id)).toEqual([a2, a1]);

      const topicThread = await bobClient.messages.list({
        conversation: { topicId: teamId, key: `t:${teamId}` },
      });
      expect(topicThread.items.map((item) => item.body)).toEqual(["plain"]);

      await bobClient.messages.markRead({ ids: [a2] });
      const unread = await bobClient.messages.list({
        conversation: { topicId: teamId, key: "c:alpha" },
        unreadOnly: true,
      });
      expect(unread.items.map((item) => item.id)).toEqual([a1]);

      const page = await bobClient.messages.list({
        conversation: { topicId: teamId, key: "c:alpha" },
        limit: 1,
      });
      expect(page.nextCursor).toBe(a2);
      const next = await bobClient.messages.list({
        conversation: { topicId: teamId, key: "c:alpha" },
        limit: 1,
        cursor: page.nextCursor ?? "",
      });
      expect(next.items.map((item) => item.id)).toEqual([a1]);
    });

    it("is NOT_FOUND for a conversation in a topic the caller is not in", async () => {
      await publish({ topic: "team", body: "a1", conversation: alpha });
      await expect(
        clientFor(testDb.db, cid).messages.list({
          conversation: { topicId: teamId, key: "c:alpha" },
        }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
    });

    it("rejects malformed conversation refs", async () => {
      const bobClient = clientFor(testDb.db, bob);
      for (const key of ["x:alpha", "c:", `t:${opsId}`, `c:${"a".repeat(65)}`]) {
        await expect(
          bobClient.messages.list({ conversation: { topicId: teamId, key } }),
        ).rejects.toMatchObject(codeError("BAD_REQUEST"));
      }
    });
  });

  describe("open ask", () => {
    const codex = { id: "codex", name: "Codex" };
    const textReply = { type: "reply" as const, key: "say", label: "Reply", input: true };
    const ack = { type: "reply" as const, key: "ok", label: "OK" };

    it("is the newest message with an unanswered text reply, per caller", async () => {
      const older = await publish({
        topic: "team",
        title: "Older ask",
        conversation: alpha,
        sender: codex,
        actions: [textReply],
      });
      const newer = await publish({
        topic: "team",
        title: "Newer ask",
        conversation: alpha,
        sender: codex,
        actions: [ack, { ...textReply, key: "first" }, { ...textReply, key: "second" }],
      });
      // A later message without a text reply does not hide the ask.
      await publish({ topic: "team", body: "status", conversation: alpha, actions: [ack] });
      await publish({ topic: "team", body: "plain" });
      const bobClient = clientFor(testDb.db, bob);
      const conversation = { topicId: teamId, key: "c:alpha" };

      const openAsk = async (client: typeof bobClient) =>
        (await client.conversations.get({ conversation })).openAsk;
      // The first unanswered text action of the newest such message; acks do not count.
      expect(await openAsk(bobClient)).toEqual({
        messageId: newer,
        actionKey: "first",
        senderName: "Codex",
        title: "Newer ask",
      });

      await bobClient.responses.create({ messageId: newer, actionKey: "first", text: "a" });
      expect(await openAsk(bobClient)).toMatchObject({ messageId: newer, actionKey: "second" });
      await bobClient.responses.create({ messageId: newer, actionKey: "second", text: "b" });
      // Older pages count too: the composer must not depend on what the app loaded.
      expect(await openAsk(bobClient)).toEqual({
        messageId: older,
        actionKey: "say",
        senderName: "Codex",
        title: "Older ask",
      });
      // Answers are per user: Ada still has the newest one open.
      expect(await openAsk(clientFor(testDb.db, ada))).toMatchObject({
        messageId: newer,
        actionKey: "first",
      });

      await bobClient.responses.create({ messageId: older, actionKey: "say", text: "c" });
      expect(await openAsk(bobClient)).toBeNull();

      // The list carries the same open ask; other conversations have none.
      const { items } = await clientFor(testDb.db, ada).conversations.list({});
      const byKey = new Map(items.map((item) => [`${item.topic}/${item.key}`, item.openAsk]));
      expect(byKey.get("team/c:alpha")).toMatchObject({ messageId: newer, actionKey: "first" });
      expect(byKey.get(`team/t:${teamId}`)).toBeNull();
    });

    it("leaves out expired asks", async () => {
      const ask = await publish({ topic: "team", conversation: alpha, actions: [textReply] });
      await publish({ topic: "team", body: "later", conversation: alpha });
      await expire([ask]);
      const summary = await clientFor(testDb.db, bob).conversations.get({
        conversation: { topicId: teamId, key: "c:alpha" },
      });
      expect(summary.openAsk).toBeNull();
    });
  });

  describe("get", () => {
    it("is the conversation's list row", async () => {
      await publish({ topic: "team", body: "a1", conversation: alpha });
      await publish({ topic: "team", body: "b1", conversation: { id: "beta" } });
      const bobClient = clientFor(testDb.db, bob);
      const { items } = await bobClient.conversations.list({});
      const alphaRow = items.find((item) => item.key === "c:alpha");
      expect(
        await bobClient.conversations.get({ conversation: { topicId: teamId, key: "c:alpha" } }),
      ).toEqual(alphaRow);
    });

    it("is NOT_FOUND outside the caller's topics or without visible messages", async () => {
      const a1 = await publish({ topic: "team", body: "a1", conversation: alpha });
      const conversation = { topicId: teamId, key: "c:alpha" };
      await expect(
        clientFor(testDb.db, cid).conversations.get({ conversation }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      await expect(
        clientFor(testDb.db, bob).conversations.get({
          conversation: { topicId: teamId, key: "c:nothing" },
        }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
      await expire([a1]);
      await expect(
        clientFor(testDb.db, bob).conversations.get({ conversation }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
    });
  });

  describe("markRead by conversation", () => {
    it("marks every visible message of that conversation only", async () => {
      const a1 = await publish({ topic: "team", body: "a1", conversation: alpha });
      const a2 = await publish({ topic: "team", body: "a2", conversation: alpha });
      const expiredAlpha = await publish({ topic: "team", body: "a3", conversation: alpha });
      await publish({ topic: "team", body: "plain" });
      await publish({ topic: "ops", body: "ops-a", conversation: alpha });
      await expire([expiredAlpha]);
      const bobClient = clientFor(testDb.db, bob);

      const conversation = { topicId: teamId, key: "c:alpha" };
      expect(await bobClient.messages.markRead({ conversation })).toEqual({ updated: 2 });
      expect(await bobClient.messages.markRead({ conversation })).toEqual({ updated: 0 });
      const read = await bobClient.messages.list({ conversation });
      expect(read.items.map((item) => [item.id, item.read])).toEqual([
        [a2, true],
        [a1, true],
      ]);
      const unread = await bobClient.messages.list({ unreadOnly: true });
      expect(unread.items.map((item) => item.body)).toEqual(["ops-a", "plain"]);

      // Not a member: nothing to mark.
      expect(await clientFor(testDb.db, cid).messages.markRead({ conversation })).toEqual({
        updated: 0,
      });
    });
  });

  describe("publish", () => {
    it("stores the conversation key", async () => {
      const withConversation = await publish({ topic: "team", conversation: alpha });
      const plain = await publish({ topic: "team" });
      const rows = await testDb.db
        .select({ id: message.id, key: message.conversationKey })
        .from(message)
        .where(inArray(message.id, [withConversation, plain]));
      expect(new Map(rows.map((row) => [row.id, row.key]))).toEqual(
        new Map([
          [withConversation, "c:alpha"],
          [plain, `t:${teamId}`],
        ]),
      );
    });
  });
});

describe("conversation_key migration", () => {
  it("derives the key for an insert that leaves it out", async () => {
    const testDb = await createTestDb();
    try {
      const { db, d1 } = testDb;
      const ada = await seedUser(db, "ada");
      const owner = clientFor(db, ada);
      const { id: topicId } = await owner.topics.create({ name: "raw" });
      const later = Date.now() + 86_400_000;
      const insert = d1.prepare(
        `insert into message (id, topic_id, body, priority, tags_json, actions_json, conversation_json, expires_at)
         values (?, ?, ?, 3, '[]', '[]', ?, ?)`,
      );
      await d1.batch([
        insert.bind("msg_01jd8x5k2m9q7r4t6v8w0y0001", topicId, "plain", null, later),
        insert.bind("msg_01jd8x5k2m9q7r4t6v8w0y0002", topicId, "conv", '{"id":"alpha"}', later),
      ]);

      const rows = await db
        .select({ id: message.id, key: message.conversationKey })
        .from(message)
        .where(eq(message.topicId, topicId))
        .orderBy(message.id);
      expect(rows.map((row) => row.key)).toEqual([`t:${topicId}`, "c:alpha"]);
      const { items } = await owner.conversations.list({});
      expect(items.map((item) => [item.key, item.lastMessage.body])).toEqual([
        ["c:alpha", "conv"],
        [`t:${topicId}`, "plain"],
      ]);
    } finally {
      await testDb.dispose();
    }
  });

  it("backfills existing messages from conversation_json or the topic", async () => {
    const testDb = await createTestDb({ stopBefore: CONVERSATION_KEY_MIGRATION });
    try {
      const { d1 } = testDb;
      const topicId = "top_01jd8x5k2m9q7r4t6v8w0y3z5a";
      const later = Date.now() + 86_400_000;
      const insertMessage = d1.prepare(
        `insert into message (id, topic_id, priority, tags_json, actions_json, conversation_json, expires_at)
         values (?, ?, 3, '[]', '[]', ?, ?)`,
      );
      await d1.batch([
        d1.prepare("insert into topic (id, name) values (?, 'legacy')").bind(topicId),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0001",
          topicId,
          '{"id":"alpha","title":"Alpha"}',
          later,
        ),
        insertMessage.bind("msg_01jd8x5k2m9q7r4t6v8w0y0002", topicId, null, later),
      ]);

      await testDb.migrateRest();

      const rows = await testDb.db
        .select({ id: message.id, key: message.conversationKey })
        .from(message)
        .where(eq(message.topicId, topicId))
        .orderBy(message.id);
      expect(rows).toEqual([
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0001", key: "c:alpha" },
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0002", key: `t:${topicId}` },
      ]);
    } finally {
      await testDb.dispose();
    }
  });
});
