import { newId } from "@notifier/db/ids";
import {
  device,
  invite,
  message,
  messageRead,
  messageResponse,
} from "@notifier/db/schema/notifier";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRetention } from "../src/retention";
import { createTestDb, type TestDb } from "./db";
import { clientFor, seedUser, type TestUser } from "./helpers";

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 10, 20, 12));

describe("runRetention", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    const { id: topicId } = await owner.topics.create({ name: "team" });
    await owner.members.add({ topicId, email: bob.email, role: "subscriber" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  /** Publishes a message and moves its `expiresAt` to `now + offsetMs`. */
  async function messageExpiringIn(offsetMs: number) {
    const { id } = await clientFor(testDb.db, ada).messages.publish({
      topic: "team",
      actions: [{ type: "reply", label: "Ack" }],
    });
    await testDb.db
      .update(message)
      .set({ expiresAt: new Date(NOW.getTime() + offsetMs) })
      .where(eq(message.id, id));
    return id;
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

    const result = await runRetention(testDb.db, { now: NOW });

    expect(result).toEqual({ messages: 1, messagesDone: true, invites: 0, devices: 0 });
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
    const result = await runRetention(testDb.db, { now: NOW, batchSize: 2 });
    expect(result.messages).toBe(5);
    expect(result.messagesDone).toBe(true);
    expect(await count(message)).toBe(1);
  });

  it("stops deleting messages when the time budget is used up", async () => {
    for (let index = 0; index < 5; index += 1) {
      await messageExpiringIn(-DAY);
    }
    let clock = 0;
    const result = await runRetention(testDb.db, {
      now: NOW,
      batchSize: 2,
      budgetMs: 1000,
      // Each check advances 600 ms: one batch runs, the second check is over budget.
      clock: () => {
        clock += 600;
        return clock;
      },
    });
    expect(result.messages).toBe(2);
    expect(result.messagesDone).toBe(false);
    expect(await count(message)).toBe(3);
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

    const result = await runRetention(testDb.db, { now: NOW });

    expect(result.invites).toBe(3);
    const left = (await testDb.db.select({ id: invite.id }).from(invite)).map((row) => row.id);
    expect(left.sort()).toEqual([
      "acceptedRecently",
      "expiredRecently",
      "pending",
      "revokedRecently",
    ]);
  });

  it("deletes devices not seen for 60 days", async () => {
    for (const [token, daysAgo] of [
      ["stale", 61],
      ["recent", 59],
    ] as const) {
      await testDb.db.insert(device).values({
        id: newId("device"),
        userId: bob.id,
        pushToken: token,
        name: token,
        platform: "android",
        lastSeenAt: new Date(NOW.getTime() - daysAgo * DAY),
      });
    }
    const result = await runRetention(testDb.db, { now: NOW });
    expect(result.devices).toBe(1);
    const tokens = (await testDb.db.select({ token: device.pushToken }).from(device)).map(
      (row) => row.token,
    );
    expect(tokens).toEqual(["recent"]);
  });

  it("touches nothing when nothing is due", async () => {
    await messageExpiringIn(DAY);
    expect(await runRetention(testDb.db, { now: NOW })).toEqual({
      messages: 0,
      messagesDone: true,
      invites: 0,
      devices: 0,
    });
    expect(await count(message)).toBe(1);
  });
});
