import { UNUSED_UPLOAD_TTL_MS } from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { attachment, device, feature, invite, message } from "@notifier/db/schema/notifier";
import { and, isNull, type SQL, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { deleteKeys, type FileBucket } from "./lib/files";
import { DAY_MS } from "./lib/token-scope";

/** Accepted, revoked and expired invites are kept this long after they end. */
export const ENDED_INVITE_KEEP_MS = 30 * DAY_MS;
/** Devices not seen for this long are deleted. */
export const STALE_DEVICE_MS = 60 * DAY_MS;
/** A feature with no messages left is deleted this long after its last activity. */
export const IDLE_FEATURE_MS = 30 * DAY_MS;
/** `R2Bucket.delete` takes at most 1,000 keys, so attachment batches stay at or below it. */
const MAX_ATTACHMENT_BATCH = 1000;

export type RetentionOptions = {
  /** The time the run treats as now. */
  now: Date;
  /** Where attachment files live; they are deleted before their rows. */
  bucket: FileBucket;
  /** Rows deleted per statement. */
  batchSize?: number;
  /** The whole run stops once this much time has passed; the next run continues. */
  budgetMs?: number;
  /** Clock for the budget, in milliseconds. */
  clock?: () => number;
};

export type RetentionResult = {
  /** Attachments of expired messages (R2 object and row). */
  attachments: number;
  /** Uploads never attached to a message (R2 object and row). */
  uploads: number;
  messages: number;
  /** Features with no messages left, idle for 30 days. */
  features: number;
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
 * Deletes attachments matching `where`. Each batch first claims its rows in one statement
 * by setting `expires_at` to 0: a publish only links an upload whose `expires_at` is still
 * ahead, so a claimed upload can no longer be attached, and one a publish linked first no
 * longer matches `where`. Then the R2 objects go, then the rows (still matching `guard`).
 * A failed R2 call leaves the claimed rows for the next run instead of leaking files.
 */
async function deleteAttachmentsInBatches(
  db: Database,
  batch: { bucket: FileBucket; where: SQL; guard?: SQL; size: number; inBudget: () => boolean },
) {
  const size = Math.min(batch.size, MAX_ATTACHMENT_BATCH);
  let deleted = 0;
  while (batch.inBudget()) {
    // biome-ignore lint/performance/noAwaitInLoops: each batch runs only if the previous one was full.
    const rows = await db
      .update(attachment)
      .set({ expiresAt: new Date(0) })
      .where(
        sql`${attachment.id} in (select "id" from ${attachment} where ${batch.where} limit ${size})`,
      )
      .returning({ id: attachment.id, key: attachment.r2Key });
    if (rows.length > 0) {
      await deleteKeys(
        batch.bucket,
        rows.map((row) => row.key),
      );
      // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
      await db
        .delete(attachment)
        .where(
          and(
            sql`${attachment.id} in (select value from json_each(${JSON.stringify(rows.map((row) => row.id))}))`,
            batch.guard,
          ),
        );
    }
    deleted += rows.length;
    if (rows.length < size) {
      return { deleted, done: true };
    }
  }
  return { deleted, done: false };
}

/**
 * The hourly cleanup from `architecture/retention.mdx`, all under one time budget:
 *
 * 1. Attachments of expired messages: R2 objects, then rows (`attachment_expiresAt_idx`;
 *    a linked attachment carries its message's `expiresAt`).
 * 2. Uploads never attached to a message, `UNUSED_UPLOAD_TTL_MS` after the upload, and
 *    rows whose message was deleted (`message_id` set null). Same order: R2, then rows.
 * 3. Expired messages (uses `message_expiresAt_idx`). Responses and read state go with
 *    them (`on delete cascade`).
 * 4. Features with no messages left whose last activity (last message, else creation) is
 *    over 30 days old. Nothing references a feature, so nothing cascades; projects and
 *    their icons are never deleted here.
 * 5. Invites that ended (accepted, revoked or expired) more than 30 days ago.
 * 6. Devices not seen for 60 days.
 *
 * Invites and devices are scanned without an index: both tables hold a handful of rows
 * per user, so an index would cost more on every write than it saves here. Features are
 * scanned too (a few per project); each one's "no messages" check is an index search on
 * `message_projectId_conversationKey_id_idx`.
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

  const attachments = await deleteAttachmentsInBatches(db, {
    bucket: options.bucket,
    where: sql`${attachment.expiresAt} < ${now.getTime()} and ${attachment.messageId} is not null`,
    size: batchSize,
    inBudget,
  });
  const uploads = await deleteAttachmentsInBatches(db, {
    bucket: options.bucket,
    where: sql`${attachment.messageId} is null and ${attachment.createdAt} < ${now.getTime() - UNUSED_UPLOAD_TTL_MS}`,
    guard: isNull(attachment.messageId),
    size: batchSize,
    inBudget,
  });
  const messages = await deleteInBatches(db, {
    table: message,
    where: sql`${message.expiresAt} < ${now.getTime()}`,
    size: batchSize,
    inBudget,
  });
  const features = await deleteInBatches(db, {
    table: feature,
    where: sql`coalesce(${feature.lastMessageAt}, ${feature.createdAt}) < ${now.getTime() - IDLE_FEATURE_MS} and not exists (select 1 from ${message} where ${message.projectId} = ${feature.projectId} and ${message.conversationKey} = 'c:' || ${feature.slug})`,
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
    attachments: attachments.deleted,
    uploads: uploads.deleted,
    messages: messages.deleted,
    features: features.deleted,
    invites: invites.deleted,
    devices: devices.deleted,
    done:
      attachments.done &&
      uploads.done &&
      messages.done &&
      features.done &&
      invites.done &&
      devices.done,
  };
}
