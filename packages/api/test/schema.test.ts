import { newId } from "@notifier/db/ids";
import { session, user } from "@notifier/db/schema/auth";
import { message, topic, topicMember } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";

describe("notifier schema", () => {
  let testDb: TestDb | undefined;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb?.dispose();
  });

  it("stores a topic with members and messages and cascades on delete", async () => {
    if (!testDb) {
      throw new Error("test database not created");
    }
    const { db } = testDb;
    const userId = "user_1";
    const topicId = newId("topic");
    const messageId = newId("message");
    const now = new Date();

    await db.batch([
      db.insert(user).values({ id: userId, name: "Ada", email: "ada@example.com" }),
      db.insert(user).values({ id: "user_2", name: "Bob", email: "bob@example.com" }),
      db.insert(session).values({
        id: "session_ada",
        token: "token_ada",
        userId,
        expiresAt: new Date(now.getTime() + 86_400_000),
      }),
      db.insert(session).values({
        id: "session_bob",
        token: "token_bob",
        userId: "user_2",
        expiresAt: new Date(now.getTime() + 86_400_000),
      }),
      db.insert(topic).values({ id: topicId, name: "alerts" }),
      db.insert(topicMember).values({ topicId, userId, role: "owner" }),
      db.insert(message).values({
        id: messageId,
        topicId,
        title: "Hello",
        body: "World",
        priority: 3,
        tagsJson: "[]",
        actionsJson: "[]",
        conversationKey: `t:${topicId}`,
        publishedBy: userId,
        expiresAt: new Date(now.getTime() + 86_400_000),
      }),
    ]);

    const found = await db.query.topic.findFirst({
      where: { id: topicId },
      with: { members: true, messages: true },
    });
    expect(found?.name).toBe("alerts");
    expect(found?.defaultPriority).toBe(3);
    expect(found?.retentionDays).toBe(30);
    expect(found?.members).toEqual([expect.objectContaining({ topicId, userId, role: "owner" })]);
    expect(found?.messages.map((row) => row.id)).toEqual([messageId]);

    const owner = await db.query.user.findFirst({
      where: { id: userId },
      with: { memberships: true, sessions: true },
    });
    expect(owner?.memberships.map((row) => row.topicId)).toEqual([topicId]);
    expect(owner?.sessions.map((row) => row.id)).toEqual(["session_ada"]);

    await db.delete(topic).where(eq(topic.id, topicId));

    expect(await db.select().from(topicMember)).toEqual([]);
    expect(await db.select().from(message)).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("rejects a fractional message priority", async () => {
    if (!testDb) {
      throw new Error("test database not created");
    }
    const { db } = testDb;
    const topicId = newId("topic");
    await db.insert(topic).values({ id: topicId, name: "fractional" });
    await expect(
      db.insert(message).values({
        id: newId("message"),
        topicId,
        priority: 2.5,
        tagsJson: "[]",
        actionsJson: "[]",
        conversationKey: `t:${topicId}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow();
  });
});
