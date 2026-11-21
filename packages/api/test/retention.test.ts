import { UNUSED_UPLOAD_TTL_MS } from "@notifier/contract/message";
import { newId } from "@notifier/db/ids";
import {
  attachment,
  device,
  feature,
  invite,
  message,
  messageRead,
  messageResponse,
  project,
} from "@notifier/db/schema/notifier";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRetention } from "../src/retention";
import { createTestDb, type TestDb } from "./db";
import { clientFor, publicClientFor, seedUser, type TestUser } from "./helpers";

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 10, 20, 12));
const UPLOADED_ICON = /\/api\/icons\//u;

describe("runRetention", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    const { id: projectId } = await owner.projects.create({ name: "team" });
    await owner.members.add({ projectId, email: bob.email, role: "subscriber" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** Publishes a message and moves its `expiresAt` to `now + offsetMs`. */
  async function messageExpiringIn(offsetMs: number) {
    const { id } = await clientFor(testDb.db, ada).messages.publish({
      project: "team",
      actions: [{ type: "reply", label: "Ack" }],
    });
    await testDb.db
      .update(message)
      .set({ expiresAt: new Date(NOW.getTime() + offsetMs) })
      .where(eq(message.id, id));
    return id;
  }

  async function staleDevice(token: string, daysAgo: number) {
    await testDb.db.insert(device).values({
      id: newId("device"),
      userId: bob.id,
      pushToken: token,
      name: token,
      platform: "android",
      lastSeenAt: new Date(NOW.getTime() - daysAgo * DAY),
    });
  }

  async function count(table: typeof message | typeof messageRead | typeof messageResponse) {
    const [row] = await testDb.db.select({ n: sql<number>`count(*)` }).from(table);
    return row?.n ?? 0;
  }

  it("deletes expired messages with their reads and responses, and keeps the rest", async () => {
    const expired = await messageExpiringIn(-1);
    const kept = await messageExpiringIn(DAY);
    for (const id of [expired, kept]) {
      await testDb.db.insert(messageRead).values({ messageId: id, userId: bob.id });
      await testDb.db.insert(messageResponse).values({
        id: newId("response"),
        messageId: id,
        userId: bob.id,
        actionKey: "0",
        kind: "ack",
      });
    }

    const result = await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW });

    expect(result).toEqual({
      attachments: 0,
      uploads: 0,
      messages: 1,
      features: 0,
      invites: 0,
      devices: 0,
      done: true,
    });
    const ids = (await testDb.db.select({ id: message.id }).from(message)).map((row) => row.id);
    expect(ids).toEqual([kept]);
    expect(await count(messageRead)).toBe(1);
    expect(await count(messageResponse)).toBe(1);
  });

  it("deletes in batches until no expired message is left", async () => {
    for (let index = 0; index < 5; index += 1) {
      await messageExpiringIn(-DAY);
    }
    await messageExpiringIn(DAY);
    const result = await runRetention(testDb.db, {
      bucket: testDb.files.bucket,
      now: NOW,
      batchSize: 2,
    });
    expect(result.messages).toBe(5);
    expect(result.done).toBe(true);
    expect(await count(message)).toBe(1);
  });

  it("stops the whole run when the time budget is used up", async () => {
    for (let index = 0; index < 5; index += 1) {
      await messageExpiringIn(-DAY);
    }
    await staleDevice("stale", 61);
    let clock = 0;
    const result = await runRetention(testDb.db, {
      bucket: testDb.files.bucket,
      now: NOW,
      batchSize: 2,
      budgetMs: 1000,
      // Each check advances 300 ms: the two attachment passes and one message batch run,
      // the next check is over budget.
      clock: () => {
        clock += 300;
        return clock;
      },
    });
    expect(result.messages).toBe(2);
    expect(result.done).toBe(false);
    expect(await count(message)).toBe(3);
    // Invites and devices share the budget, so the stale device waits for the next run.
    expect(result.devices).toBe(0);
    expect(await testDb.db.select({ id: device.id }).from(device)).toHaveLength(1);
  });

  it("deletes invites that ended more than 30 days ago", async () => {
    const at = (days: number) => new Date(NOW.getTime() + days * DAY);
    const rows = {
      acceptedLongAgo: { expiresAt: at(-20), acceptedAt: at(-31), acceptedBy: bob.id },
      acceptedRecently: { expiresAt: at(-40), acceptedAt: at(-29), acceptedBy: bob.id },
      revokedLongAgo: { expiresAt: at(10), revokedAt: at(-31) },
      revokedRecently: { expiresAt: at(-40), revokedAt: at(-1) },
      expiredLongAgo: { expiresAt: at(-31) },
      expiredRecently: { expiresAt: at(-29) },
      pending: { expiresAt: at(7) },
    };
    for (const [name, fields] of Object.entries(rows)) {
      await testDb.db.insert(invite).values({
        id: name,
        createdBy: ada.id,
        codeHash: name,
        grantsJson: "[]",
        ...fields,
      });
    }

    const result = await runRetention(testDb.db, {
      bucket: testDb.files.bucket,
      now: NOW,
      batchSize: 2,
    });

    expect(result.invites).toBe(3);
    const left = (await testDb.db.select({ id: invite.id }).from(invite)).map((row) => row.id);
    expect(left.sort()).toEqual([
      "acceptedRecently",
      "expiredRecently",
      "pending",
      "revokedRecently",
    ]);
  });

  it("deletes devices not seen for 60 days, in batches", async () => {
    for (const [token, daysAgo] of [
      ["stale-1", 61],
      ["stale-2", 70],
      ["stale-3", 90],
      ["recent", 59],
    ] as const) {
      await staleDevice(token, daysAgo);
    }
    const result = await runRetention(testDb.db, {
      bucket: testDb.files.bucket,
      now: NOW,
      batchSize: 2,
    });
    expect(result.devices).toBe(3);
    expect(result.done).toBe(true);
    const tokens = (await testDb.db.select({ token: device.pushToken }).from(device)).map(
      (row) => row.token,
    );
    expect(tokens).toEqual(["recent"]);
  });

  it("finds expired messages through the expires_at index", async () => {
    const plan = await testDb.d1
      .prepare(
        'explain query plan select "id" from "message" where "message"."expires_at" < ? limit 500',
      )
      .bind(NOW.getTime())
      .all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join(" ")).toContain("message_expiresAt_idx");
  });

  it("finds attachments to delete through attachment indexes", async () => {
    const plan = async (where: string) => {
      const result = await testDb.d1
        .prepare(
          `explain query plan select "id", "r2_key" from "attachment" where ${where} limit 500`,
        )
        .bind(NOW.getTime())
        .all<{ detail: string }>();
      return result.results.map((row) => row.detail).join(" ");
    };
    expect(await plan('"expires_at" < ? and "message_id" is not null')).toContain(
      "attachment_expiresAt_idx",
    );
    expect(await plan('"message_id" is null and "created_at" < ?')).toContain(
      "attachment_messageId_uidx",
    );
  });

  it("touches nothing when nothing is due", async () => {
    await messageExpiringIn(DAY);
    expect(await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW })).toEqual({
      attachments: 0,
      uploads: 0,
      features: 0,
      messages: 0,
      invites: 0,
      devices: 0,
      done: true,
    });
    expect(await count(message)).toBe(1);
  });

  describe("files and features", () => {
    async function upload(name: string) {
      const { secret } = await clientFor(testDb.db, ada).tokens.create({
        name: "ci",
        scope: { kind: "all" },
      });
      return await publicClientFor(testDb.db, secret).attachments.upload({
        project: "team",
        file: new File([name], name, { type: "text/plain" }),
      });
    }

    async function keyOf(id: string) {
      const [row] = await testDb.db.select().from(attachment).where(eq(attachment.id, id));
      return row?.r2Key ?? "";
    }

    it("deletes expired messages' attachment files before the messages", async () => {
      const expired = await upload("old.txt");
      const kept = await upload("new.txt");
      const api = clientFor(testDb.db, ada);
      const gone = await api.messages.publish({ project: "team", attachmentId: expired.id });
      const stays = await api.messages.publish({ project: "team", attachmentId: kept.id });
      for (const [id, offset] of [
        [gone.id, -1],
        [stays.id, DAY],
      ] as const) {
        const expiresAt = new Date(NOW.getTime() + offset);
        await testDb.db.update(message).set({ expiresAt }).where(eq(message.id, id));
        await testDb.db.update(attachment).set({ expiresAt }).where(eq(attachment.messageId, id));
      }
      const expiredKey = await keyOf(expired.id);
      const keptKey = await keyOf(kept.id);

      const result = await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW });
      expect(result).toMatchObject({ attachments: 1, uploads: 0, messages: 1, done: true });
      expect(await testDb.files.bucket.get(expiredKey)).toBeNull();
      expect(await testDb.files.bucket.get(keptKey)).not.toBeNull();
      expect((await testDb.db.select().from(attachment)).map((row) => row.id)).toEqual([kept.id]);
    });

    it("never deletes an old upload that a publish linked first", async () => {
      const linked = await upload("late.txt");
      await testDb.db
        .update(attachment)
        .set({ createdAt: new Date(NOW.getTime() - UNUSED_UPLOAD_TTL_MS - 1) })
        .where(eq(attachment.id, linked.id));
      await clientFor(testDb.db, ada).messages.publish({
        project: "team",
        attachmentId: linked.id,
      });
      const result = await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW });
      expect(result.uploads).toBe(0);
      expect(await testDb.files.bucket.get(await keyOf(linked.id))).not.toBeNull();
    });

    it("deletes uploads never attached within the TTL", async () => {
      const stale = await upload("stale.txt");
      const fresh = await upload("fresh.txt");
      await testDb.db
        .update(attachment)
        .set({ createdAt: new Date(NOW.getTime() - UNUSED_UPLOAD_TTL_MS - 1) })
        .where(eq(attachment.id, stale.id));
      await testDb.db
        .update(attachment)
        .set({ createdAt: new Date(NOW.getTime() - 1000) })
        .where(eq(attachment.id, fresh.id));
      const staleKey = await keyOf(stale.id);

      const result = await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW });
      expect(result).toMatchObject({ attachments: 0, uploads: 1, done: true });
      expect(await testDb.files.bucket.get(staleKey)).toBeNull();
      expect(await testDb.files.bucket.get(await keyOf(fresh.id))).not.toBeNull();
    });

    it("deletes features idle for 30 days with no messages, and keeps projects and icons", async () => {
      const api = clientFor(testDb.db, ada);
      const { id: projectId } = (await api.projects.list()).find(
        (item) => item.name === "team",
      ) ?? {
        id: "",
      };
      await api.projects.setIcon({
        id: projectId,
        contentType: "image/png",
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
      });
      // "busy" still has a message; "idle" had one 31 days ago that expired; "fresh" is new.
      await api.messages.publish({ project: "team", conversation: { id: "busy" } });
      await api.messages.publish({ project: "team", conversation: { id: "idle" } });
      await api.features.create({ projectId, name: "fresh" });
      const old = new Date(NOW.getTime() - 31 * DAY);
      await testDb.db
        .update(feature)
        .set({ lastMessageAt: old, createdAt: old })
        .where(sql`${feature.slug} in ('busy', 'idle')`);
      await testDb.db
        .update(message)
        .set({ expiresAt: new Date(NOW.getTime() - 1) })
        .where(eq(message.conversationKey, "c:idle"));
      await testDb.db
        .update(feature)
        .set({ createdAt: new Date(NOW.getTime() - DAY) })
        .where(eq(feature.slug, "fresh"));

      const result = await runRetention(testDb.db, { bucket: testDb.files.bucket, now: NOW });
      expect(result).toMatchObject({ messages: 1, features: 1, done: true });
      const slugs = (await testDb.db.select({ slug: feature.slug }).from(feature))
        .map((row) => row.slug)
        .sort();
      expect(slugs).toEqual(["busy", "fresh"]);
      const [kept] = await testDb.db.select().from(project).where(eq(project.id, projectId));
      expect(kept?.iconUrl).toMatch(UPLOADED_ICON);
      expect((await testDb.files.bucket.list({ prefix: "icons/" })).objects).toHaveLength(1);
    });
  });
});
