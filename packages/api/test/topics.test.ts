import { newId } from "@notifier/db/ids";
import { user } from "@notifier/db/schema/auth";
import { message, messageRead } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, seedUser, type TestUser } from "./helpers";

const DAY_MS = 86_400_000;
const TOPIC_ID = /^top_[0-9a-z]{26}$/u;

describe("me and topics", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("requires a session", async () => {
    const anonymous = clientFor(testDb.db, null);
    await expect(anonymous.me.get()).rejects.toMatchObject(definedError("UNAUTHORIZED"));
    await expect(anonymous.topics.list()).rejects.toMatchObject(definedError("UNAUTHORIZED"));
    await expect(anonymous.topics.create({ name: "alerts" })).rejects.toMatchObject(
      definedError("UNAUTHORIZED"),
    );
  });

  it("returns the session user from me.get", async () => {
    await expect(clientFor(testDb.db, ada).me.get()).resolves.toEqual({
      id: "ada",
      name: "User ada",
      email: "ada@example.com",
      image: null,
    });
  });

  it("returns null for stored avatar images that are not absolute URLs", async () => {
    await testDb.db.update(user).set({ image: "/avatars/ada.png" }).where(eq(user.id, ada.id));
    await testDb.db
      .update(user)
      .set({ image: "https://example.com/bob.png" })
      .where(eq(user.id, bob.id));
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "avatars" });
    await owner.members.add({ topicId: created.id, email: bob.email, role: "subscriber" });

    const members = await owner.members.list({ topicId: created.id });
    expect(
      Object.fromEntries(members.map((member) => [member.user.id, member.user.image])),
    ).toEqual({ ada: null, bob: "https://example.com/bob.png" });
  });

  it("creates a topic with owner membership and subscription, and rejects duplicate names", async () => {
    const client = clientFor(testDb.db, ada);
    const created = await client.topics.create({ name: "alerts", displayName: "Alerts" });

    expect(created).toMatchObject({
      name: "alerts",
      displayName: "Alerts",
      description: null,
      defaultPriority: 3,
      retentionDays: 30,
      role: "owner",
      subscribed: true,
      muted: false,
      unreadCount: 0,
      lastMessageAt: null,
    });
    expect(created.id).toMatch(TOPIC_ID);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);

    await expect(clientFor(testDb.db, bob).topics.create({ name: "alerts" })).rejects.toMatchObject(
      definedError("CONFLICT"),
    );
  });

  it("lists topics with role, subscription and unread state", async () => {
    const { db } = testDb;
    const adaClient = clientFor(db, ada);
    const zeta = await adaClient.topics.create({ name: "zeta" });
    const alpha = await clientFor(db, bob).topics.create({ name: "alpha" });
    await clientFor(db, bob).members.add({
      topicId: alpha.id,
      email: ada.email,
      role: "publisher",
    });
    await adaClient.topics.setSubscription({ topicId: alpha.id, subscribed: true, muted: true });
    await adaClient.topics.setSubscription({ topicId: zeta.id, subscribed: false });

    const now = Date.now();
    const message_ = (id: string, createdAt: number, expiresAt: number) => ({
      id,
      topicId: alpha.id,
      body: "hi",
      priority: 3,
      tagsJson: "[]",
      actionsJson: "[]",
      conversationKey: `t:${alpha.id}`,
      createdAt: new Date(createdAt),
      expiresAt: new Date(expiresAt),
    });
    const unread = newId("message");
    const read = newId("message");
    const expired = newId("message");
    await db.batch([
      db.insert(message).values(message_(unread, now - 3000, now + DAY_MS)),
      db.insert(message).values(message_(read, now - 2000, now + DAY_MS)),
      // Newest, but expired: neither unread nor the last message.
      db.insert(message).values(message_(expired, now - 1000, now - 1)),
      db.insert(messageRead).values({ messageId: read, userId: ada.id }),
    ]);

    // Every user also has their personal General project.
    const topics = (await adaClient.topics.list()).filter((t) => !t.personal);
    expect(topics.map((t) => t.name)).toEqual(["alpha", "zeta"]);
    expect(topics[0]).toMatchObject({
      role: "publisher",
      subscribed: true,
      muted: true,
      unreadCount: 1,
      lastMessageAt: new Date(now - 2000).toISOString(),
    });
    expect(topics[1]).toMatchObject({
      role: "owner",
      subscribed: false,
      muted: false,
      unreadCount: 0,
      lastMessageAt: null,
    });

    // Bob has read nothing.
    const bobAlpha = (await clientFor(db, bob).topics.list()).find((t) => t.name === "alpha");
    expect(bobAlpha?.unreadCount).toBe(2);
  });

  it("hides topics from non-members", async () => {
    const created = await clientFor(testDb.db, ada).topics.create({ name: "secret" });
    await expect(clientFor(testDb.db, ada).topics.get({ id: created.id })).resolves.toMatchObject({
      name: "secret",
    });
    await expect(clientFor(testDb.db, bob).topics.get({ id: created.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    const bobs = await clientFor(testDb.db, bob).topics.list();
    expect(bobs.map((t) => [t.displayName, t.personal])).toEqual([["General", true]]);
  });

  it("lets only owners update a topic, changing only provided fields", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({
      name: "ops",
      displayName: "Ops",
      description: "Ops alerts",
      retentionDays: 7,
    });
    await owner.members.add({ topicId: created.id, email: bob.email, role: "publisher" });

    await expect(
      clientFor(testDb.db, bob).topics.update({ id: created.id, displayName: "Mine" }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    const carol = await seedUser(testDb.db, "carol");
    await expect(
      clientFor(testDb.db, carol).topics.update({ id: created.id, displayName: "Mine" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));

    const updated = await owner.topics.update({
      id: created.id,
      description: null,
      defaultPriority: 5,
      retentionDays: 7,
    });
    expect(updated).toMatchObject({
      displayName: "Ops",
      description: null,
      defaultPriority: 5,
      retentionDays: 7,
    });
  });

  it("keeps retentionDays when update omits it", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "pinned", retentionDays: 7 });
    const updated = await owner.topics.update({ id: created.id, displayName: "Pinned" });
    expect(updated.retentionDays).toBe(7);
  });

  it("uses 30 days when create omits retentionDays", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "default-retention" });
    expect(created.retentionDays).toBe(30);
  });

  it("lets only owners delete a topic, and cascades", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "temp" });
    await owner.members.add({ topicId: created.id, email: bob.email, role: "subscriber" });

    await expect(clientFor(testDb.db, bob).topics.delete({ id: created.id })).rejects.toMatchObject(
      definedError("FORBIDDEN"),
    );
    await expect(owner.topics.delete({ id: created.id })).resolves.toEqual({ ok: true });
    await expect(owner.topics.get({ id: created.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    expect(await testDb.db.query.topicMember.findMany()).toEqual([]);
    expect(await testDb.db.query.subscription.findMany()).toEqual([]);
  });

  it("subscribes, mutes and unsubscribes", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "subs" });

    await expect(
      owner.topics.setSubscription({ topicId: created.id, subscribed: false }),
    ).resolves.toMatchObject({ subscribed: false, muted: false });
    await expect(
      owner.topics.setSubscription({ topicId: created.id, subscribed: true }),
    ).resolves.toMatchObject({ subscribed: true, muted: false });
    await expect(
      owner.topics.setSubscription({ topicId: created.id, subscribed: true, muted: true }),
    ).resolves.toMatchObject({ subscribed: true, muted: true });

    await expect(
      clientFor(testDb.db, bob).topics.setSubscription({ topicId: created.id, subscribed: true }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
  });
});
