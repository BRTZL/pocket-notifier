import { newId } from "@notifier/db/ids";
import { user } from "@notifier/db/schema/auth";
import { message, topic, topicMember } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";

describe("notifier schema", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("stores a topic with members and messages and cascades on delete", async () => {
    const { db } = testDb;
    const userId = "user_1";
    const topicId = newId("topic");
    const messageId = newId("message");
    const now = new Date();

    await db.batch([
      db.insert(user).values({ id: userId, name: "Ada", email: "ada@example.com" }),
      db.insert(topic).values({ id: topicId, name: "alerts" }),
      db.insert(topicMember).values({ topicId, userId, role: "owner" }),
      db.insert(message).values({
        id: messageId,
        topicId,
        title: "Hello",
        body: "World",
        priority: 3,
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
    expect(owner?.sessions).toEqual([]);

    await db.delete(topic).where(eq(topic.id, topicId));

    expect(await db.select().from(topicMember)).toEqual([]);
    expect(await db.select().from(message)).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(1);
  });
});
