import type { Database } from "@notifier/db";
import { device, invite, message } from "@notifier/db/schema/notifier";
import { type SQL, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { DAY_MS } from "./lib/token-scope";

/** Accepted, revoked and expired invites are kept this long after they end. */
export const ENDED_INVITE_KEEP_MS = 30 * DAY_MS;
/** Devices not seen for this long are deleted. */
export const STALE_DEVICE_MS = 60 * DAY_MS;

export type RetentionOptions = {
  /** The time the run treats as now. */
  now: Date;
  /** Rows deleted per statement. */
  batchSize?: number;
  /** The whole run stops once this much time has passed; the next run continues. */
  budgetMs?: number;
  /** Clock for the budget, in milliseconds. */
  clock?: () => number;
};

export type RetentionResult = {
  messages: number;
  invites: number;
  devices: number;
  /** `false` when the budget ran out with rows possibly left for the next run. */
  done: boolean;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_BUDGET_MS = 20_000;

/**
 * Deletes rows of `table` matching `where`, `batchSize` at a time, while `inBudget`
 * holds. Counts come from D1's affected rows; no ids are loaded. `done` is `false` when
 * the budget stopped it before a short batch showed nothing was left.
 */
async function deleteInBatches(
  db: Database,
  batch: { table: SQLiteTable; where: SQL; size: number; inBudget: () => boolean },
) {
  const { table, where, size: batchSize, inBudget } = batch;
  let deleted = 0;
  while (inBudget()) {
    // Batches depend on each other: each one runs only if the previous one was full.
    // D1's `meta.changes` also counts rows removed by `on delete cascade`, so the count
    // comes from SQLite's `changes()`, which counts only this statement's own rows. A
    // batch runs both on the same connection.
    const [, counted] = await db.batch([
      db.run(
        sql`delete from ${table} where "id" in (select "id" from ${table} where ${where} limit ${batchSize})`,
      ),
      db.get<{ n: number }>(sql`select changes() as n`),
    ]);
    const changes = counted?.n ?? 0;
    deleted += changes;
    if (changes < batchSize) {
      return { deleted, done: true };
    }
  }
  return { deleted, done: false };
}

/**
 * The hourly cleanup from `architecture/retention.mdx`, all under one time budget:
 *
 * 1. Expired messages (uses `message_expiresAt_idx`). Responses and read state go with
 *    them (`on delete cascade`).
 * 2. Invites that ended (accepted, revoked or expired) more than 30 days ago.
 * 3. Devices not seen for 60 days.
 *
 * Invites and devices are scanned without an index: both tables hold a handful of rows
 * per user, so an index would cost more on every write than it saves here.
 *
 * Attachments do not exist yet. When they do, their R2 objects must be deleted before
 * their messages, and orphaned uploads swept here.
 */
export async function runRetention(
  db: Database,
  options: RetentionOptions,
): Promise<RetentionResult> {
  const { now } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const inBudget = () => clock() - startedAt < budgetMs;

  const messages = await deleteInBatches(db, {
    table: message,
    where: sql`${message.expiresAt} < ${now.getTime()}`,
    size: batchSize,
    inBudget,
  });
  const invites = await deleteInBatches(db, {
    table: invite,
    // An invite ends when it is accepted or revoked, or else when it expires.
    where: sql`coalesce(${invite.acceptedAt}, ${invite.revokedAt}, ${invite.expiresAt}) < ${now.getTime() - ENDED_INVITE_KEEP_MS}`,
    size: batchSize,
    inBudget,
  });
  const devices = await deleteInBatches(db, {
    table: device,
    where: sql`${device.lastSeenAt} < ${now.getTime() - STALE_DEVICE_MS}`,
    size: batchSize,
    inBudget,
  });

  return {
    messages: messages.deleted,
    invites: invites.deleted,
    devices: devices.deleted,
    done: messages.done && invites.done && devices.done,
  };
}
