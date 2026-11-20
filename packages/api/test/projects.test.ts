import { slugify } from "@notifier/contract/feature";
import type { Message } from "@notifier/contract/message";
import { newId } from "@notifier/db/ids";
import { device, feature, message, subscription, topic } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import {
  createFeature,
  createProject,
  ensureGeneralProject,
  findProject,
  listProjects,
  resolveSendTarget,
  sendNotification,
  updateFeatureStatus,
} from "../src/lib/projects";
import { createTestDb, type TestDb } from "./db";
import { clientFor, codeError, definedError, seedUser, type TestUser } from "./helpers";

const PROJECTS_MIGRATION = "20261120205545_projects_features_oauth";
const HASH_SLUG = /^f-[0-9a-f]{8}$/u;
const GENERAL_NAME = /^general-[0-9a-z]{26}$/u;

function spyDispatch() {
  const published: Message[] = [];
  const dispatch: Dispatch = {
    messagePublished: vi.fn((published_: Message) => {
      published.push(published_);
    }),
    messagesRead: vi.fn(),
  };
  return { dispatch, published };
}

describe("slugify", () => {
  it("lowercases, strips accents and joins words with dashes", () => {
    expect(slugify("Improving performance")).toBe("improving-performance");
    expect(slugify("  Çok hızlı İşlem!  ")).toBe("cok-hizli-islem");
    expect(slugify("v2 -- API/Auth")).toBe("v2-api-auth");
    expect(slugify("x".repeat(80))).toHaveLength(63);
    expect(slugify(`${"a".repeat(62)} b`)).toBe("a".repeat(62));
  });

  it("gives names without slug characters a stable hash slug", () => {
    const slug = slugify("🚀🔥");
    expect(slug).toMatch(HASH_SLUG);
    expect(slugify("🚀🔥")).toBe(slug);
  });
});

describe("projects and features", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    carol = await seedUser(testDb.db, "carol");
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** `rezme` owned by ada, bob publisher, carol subscriber. */
  async function seedRezme() {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.topics.create({ name: "rezme", displayName: "Rezme" });
    await owner.members.add({ topicId: created.id, email: bob.email, role: "publisher" });
    await owner.members.add({ topicId: created.id, email: carol.email, role: "subscriber" });
    return created;
  }

  async function accessOf(userId: string, name?: string) {
    const access = await findProject(testDb.db, userId, name);
    if (!access) {
      throw new Error(`no access to ${name}`);
    }
    return access;
  }

  describe("General project", () => {
    it("is created lazily, once, with its owner subscribed", async () => {
      const { db } = testDb;
      expect(await db.$count(topic)).toBe(0);
      const [first, second] = await Promise.all([
        ensureGeneralProject(db, ada.id),
        ensureGeneralProject(db, ada.id),
      ]);
      expect(second?.id).toBe(first?.id);
      expect(first).toMatchObject({ displayName: "General", personalUserId: ada.id });
      expect(first?.name).toMatch(GENERAL_NAME);
      expect(await db.$count(topic)).toBe(1);
      expect(await db.$count(subscription, eq(subscription.topicId, first?.id ?? ""))).toBe(1);

      const listed = await clientFor(db, ada).topics.list();
      expect(listed).toEqual([
        expect.objectContaining({ id: first?.id, personal: true, role: "owner", subscribed: true }),
      ]);
    });

    it("stays private: no members, no invite grants, no deletion", async () => {
      const { db } = testDb;
      const general = await ensureGeneralProject(db, ada.id);
      const owner = clientFor(db, ada);
      await expect(
        owner.members.add({ topicId: general.id, email: bob.email, role: "publisher" }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));
      await expect(
        owner.invites.create({ grants: [{ topicId: general.id, role: "subscriber" }] }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));
      await expect(owner.topics.delete({ id: general.id })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );
      await expect(clientFor(db, bob).topics.get({ id: general.id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      // Bob's own General is a different project.
      const bobGeneral = await accessOf(bob.id);
      expect(bobGeneral.topic.id).not.toBe(general.id);
      // Another user cannot address ada's General by its name either.
      expect(await findProject(db, bob.id, general.name)).toBeUndefined();
    });

    it("answers to an omitted project and to the 'general' alias", async () => {
      const general = await ensureGeneralProject(testDb.db, ada.id);
      expect((await accessOf(ada.id)).topic.id).toBe(general.id);
      expect((await accessOf(ada.id, "General")).topic.id).toBe(general.id);
      expect((await accessOf(ada.id, general.name)).topic.id).toBe(general.id);
    });
  });

  it("lists projects with roles, General and feature counts", async () => {
    const rezme = await seedRezme();
    const access = await accessOf(ada.id, "rezme");
    await createFeature(testDb.db, { access, userId: ada.id, name: "Perf" });
    const { feature: done } = await createFeature(testDb.db, {
      access,
      userId: ada.id,
      name: "Login",
    });
    await updateFeatureStatus(testDb.db, access, done.id, "done");

    const projects = await listProjects(testDb.db, bob.id);
    expect(projects.map((p) => [p.displayName, p.role, p.personal, p.featureCounts])).toEqual([
      ["General", "owner", true, { active: 0, done: 0, archived: 0 }],
      ["Rezme", "publisher", false, { active: 1, done: 1, archived: 0 }],
    ]);
    expect(projects[1]?.id).toBe(rezme.id);
  });

  describe("createProject", () => {
    it("is idempotent for owners and publishers", async () => {
      const { db } = testDb;
      const first = await createProject(db, ada.id, { name: "notes", displayName: "Notes" });
      expect(first).toMatchObject({ created: true, project: { name: "notes", role: "owner" } });
      const again = await createProject(db, ada.id, { name: "notes" });
      expect(again).toMatchObject({ created: false, project: { id: first.project.id } });

      await clientFor(db, ada).members.add({
        topicId: first.project.id,
        email: bob.email,
        role: "publisher",
      });
      await expect(createProject(db, bob.id, { name: "notes" })).resolves.toMatchObject({
        created: false,
        project: { id: first.project.id, role: "publisher" },
      });
    });

    it("refuses a name taken by a project the caller cannot publish to", async () => {
      await seedRezme();
      for (const userId of [carol.id, "dave"]) {
        if (userId === "dave") {
          await seedUser(testDb.db, "dave");
        }
        await expect(createProject(testDb.db, userId, { name: "rezme" })).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining("Pick another name"),
        });
      }
    });
  });

  describe("features", () => {
    it("creates features idempotently by slug", async () => {
      await seedRezme();
      const access = await accessOf(bob.id, "rezme");
      const first = await createFeature(testDb.db, {
        access,
        userId: bob.id,
        name: "Improving performance",
        description: "Make it fast",
      });
      expect(first).toMatchObject({
        created: true,
        feature: { slug: "improving-performance", name: "Improving performance", status: "active" },
      });
      const again = await createFeature(testDb.db, {
        access,
        userId: bob.id,
        name: "improving   PERFORMANCE",
      });
      expect(again).toMatchObject({ created: false, feature: { id: first.feature.id } });
      const explicit = await createFeature(testDb.db, {
        access,
        userId: bob.id,
        name: "Perf (v2)",
        slug: "perf-v2",
      });
      expect(explicit.feature.slug).toBe("perf-v2");
    });

    it("lets only owners and publishers create, and only owners change status", async () => {
      await seedRezme();
      const carolAccess = await accessOf(carol.id, "rezme");
      await expect(
        createFeature(testDb.db, { access: carolAccess, userId: carol.id, name: "Nope" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const bobAccess = await accessOf(bob.id, "rezme");
      const { feature: created } = await createFeature(testDb.db, {
        access: bobAccess,
        userId: bob.id,
        name: "Perf",
      });
      await expect(
        updateFeatureStatus(testDb.db, bobAccess, created.id, "done"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const updated = await updateFeatureStatus(
        testDb.db,
        await accessOf(ada.id, "rezme"),
        created.id,
        "archived",
      );
      expect(updated.status).toBe("archived");
    });

    it("rejects bad slugs at the database too", async () => {
      const general = await ensureGeneralProject(testDb.db, ada.id);
      await expect(
        testDb.db
          .insert(feature)
          .values({ id: newId("feature"), topicId: general.id, slug: "-bad", name: "Bad" }),
      ).rejects.toThrow();
      await expect(
        testDb.db
          .insert(feature)
          .values({ id: newId("feature"), topicId: general.id, slug: "Bad", name: "Bad" }),
      ).rejects.toThrow();
    });

    it("works through the app API", async () => {
      const rezme = await seedRezme();
      const bobClient = clientFor(testDb.db, bob);
      const created = await bobClient.features.create({ topicId: rezme.id, name: "Search" });
      expect(created).toMatchObject({ slug: "search", conversationKey: "c:search" });
      await expect(
        bobClient.features.create({ topicId: rezme.id, name: "Search again", slug: "search" }),
      ).resolves.toMatchObject({ id: created.id, name: "Search" });
      await expect(
        bobClient.features.updateStatus({ id: created.id, status: "done" }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));
      await clientFor(testDb.db, ada).features.updateStatus({ id: created.id, status: "done" });

      const carolClient = clientFor(testDb.db, carol);
      await expect(carolClient.features.list({ topicId: rezme.id })).resolves.toHaveLength(1);
      await expect(
        carolClient.features.list({ topicId: rezme.id, status: "active" }),
      ).resolves.toEqual([]);
      await expect(
        carolClient.features.create({ topicId: rezme.id, name: "X" }),
      ).rejects.toMatchObject(definedError("FORBIDDEN"));

      await seedUser(testDb.db, "dave");
      const dave = clientFor(testDb.db, { id: "dave", name: "Dave", email: "dave@example.com" });
      await expect(dave.features.list({ topicId: rezme.id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      await expect(
        dave.features.updateStatus({ id: created.id, status: "active" }),
      ).rejects.toMatchObject(definedError("NOT_FOUND"));
    });
  });

  describe("resolveSendTarget", () => {
    it("sends to General when no project is given", async () => {
      const target = await resolveSendTarget(testDb.db, ada.id, {});
      expect(target.access.topic.personalUserId).toBe(ada.id);
      expect(target.feature).toBeUndefined();
    });

    it("explains a missing project", async () => {
      await expect(resolveSendTarget(testDb.db, ada.id, { project: "nope" })).rejects.toMatchObject(
        {
          code: "NOT_FOUND",
          message:
            "Project 'nope' not found. Call list_projects to see your projects, or create_project to add it.",
        },
      );
    });

    it("finds features by slug or name and creates missing ones", async () => {
      await seedRezme();
      const access = await accessOf(ada.id, "rezme");
      const { feature: perf } = await createFeature(testDb.db, {
        access,
        userId: ada.id,
        name: "Improving performance",
      });
      for (const ref of [
        "improving-performance",
        "IMPROVING PERFORMANCE",
        "Improving performance!",
      ]) {
        const target = await resolveSendTarget(testDb.db, bob.id, {
          project: "rezme",
          feature: ref,
        });
        expect(target).toMatchObject({ featureCreated: false, feature: { id: perf.id } });
      }
      const fresh = await resolveSendTarget(testDb.db, bob.id, {
        project: "Rezme",
        feature: "Dark mode",
      });
      expect(fresh).toMatchObject({
        featureCreated: true,
        feature: { slug: "dark-mode", name: "Dark mode", createdBy: bob.id },
      });
    });

    it("refuses subscribers", async () => {
      await seedRezme();
      await expect(
        resolveSendTarget(testDb.db, carol.id, { project: "rezme" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("sendNotification", () => {
    it("publishes into the feature's conversation and pushes it", async () => {
      const rezme = await seedRezme();
      await testDb.db.insert(device).values({
        id: newId("device"),
        userId: carol.id,
        pushToken: "push-carol",
        name: "Pixel",
        platform: "android",
      });
      const { dispatch, published } = spyDispatch();
      const target = await resolveSendTarget(testDb.db, bob.id, {
        project: "rezme",
        feature: "Perf",
      });
      const result = await sendNotification(testDb.db, {
        ...target,
        userId: bob.id,
        dispatch,
        input: {
          title: "Benchmarks done",
          body: "p95 is 120 ms",
          priority: 4,
          tags: ["perf"],
          url: "https://example.com/run/1",
          ask: { question: "Ship it?", quickReplies: ["Yes", "No"] },
          links: [{ label: "PR", url: "https://example.com/pr/1" }],
          sender: { id: "client_123", name: "Claude Code" },
        },
      });
      expect(result.deliveredTo).toBe(1);
      expect(result.message).toMatchObject({ topicId: rezme.id, conversationKey: "c:perf" });

      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        topic: "rezme",
        title: "Benchmarks done",
        body: "p95 is 120 ms\n\nShip it?",
        priority: 4,
        clickUrl: "https://example.com/run/1",
        conversation: { id: "perf", title: "Perf" },
        sender: { id: "client_123", name: "Claude Code" },
        publishedBy: { id: bob.id },
        actions: [
          { type: "view", key: "link0", label: "PR", url: "https://example.com/pr/1" },
          { type: "reply", key: "reply", input: true, quickReplies: ["Yes", "No"] },
        ],
      });

      const [stored] = await testDb.db.select().from(feature).where(eq(feature.slug, "perf"));
      expect(stored?.lastMessageAt?.getTime()).toBe(result.message.createdAt.getTime());
      // The app sees it as a conversation of the topic.
      const conversations = await clientFor(testDb.db, carol).conversations.list({});
      expect(conversations.items[0]).toMatchObject({
        key: "c:perf",
        title: "Perf",
        openAsk: { messageId: result.message.id, actionKey: "reply", senderName: "Claude Code" },
      });
    });

    it("sends without project or feature into General", async () => {
      const { dispatch, published } = spyDispatch();
      const target = await resolveSendTarget(testDb.db, ada.id, {});
      const result = await sendNotification(testDb.db, {
        ...target,
        userId: ada.id,
        dispatch,
        input: { title: "Hello" },
      });
      expect(result.deliveredTo).toBe(0);
      expect(published[0]).toMatchObject({ conversation: null, sender: null, body: "" });
      expect(result.message.topicId).toBe(target.access.topic.id);
    });

    it("rejects input the publish rules refuse", async () => {
      const target = await resolveSendTarget(testDb.db, ada.id, {});
      await expect(
        sendNotification(testDb.db, {
          ...target,
          userId: ada.id,
          dispatch: spyDispatch().dispatch,
          input: { title: "x", url: "javascript:alert(1)" },
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
    });
  });
});

describe("projects migration", () => {
  it("adds personal_user_id without rebuilding topic, so messages survive", async () => {
    const testDb = await createTestDb({ stopBefore: PROJECTS_MIGRATION });
    try {
      const { d1 } = testDb;
      const topicId = "top_01jd8x5k2m9q7r4t6v8w0y3z5a";
      await d1.batch([
        d1.prepare("insert into topic (id, name) values (?, 'legacy')").bind(topicId),
        d1
          .prepare(
            `insert into message (id, topic_id, priority, tags_json, actions_json, expires_at)
             values ('msg_01jd8x5k2m9q7r4t6v8w0y0001', ?, 3, '[]', '[]', ?)`,
          )
          .bind(topicId, Date.now() + 86_400_000),
      ]);
      await testDb.migrateRest();
      expect(await testDb.db.$count(message, eq(message.topicId, topicId))).toBe(1);
      const [row] = await testDb.db.select().from(topic).where(eq(topic.id, topicId));
      expect(row?.personalUserId).toBeNull();
    } finally {
      await testDb.dispose();
    }
  });
});
