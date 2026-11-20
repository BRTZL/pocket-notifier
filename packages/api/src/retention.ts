import type { Database } from "@notifier/db";
import { device, invite, message } from "@notifier/db/schema/notifier";
import { lt, sql } from "drizzle-orm";

import { DAY_MS } from "./lib/token-scope";

/** Accepted, revoked and expired invites are kept this long after they end. */
export const ENDED_INVITE_KEEP_MS = 30 * DAY_MS;
/** Devices not seen for this long are deleted. */
export const STALE_DEVICE_MS = 60 * DAY_MS;

export type RetentionOptions = {
  /** The time the run treats as now. */
  now: Date;
  /** Expired messages deleted per statement. */
  batchSize?: number;
  /** Stop deleting messages once this much time has passed; the next run continues. */
  budgetMs?: number;
  /** Clock for the budget, in milliseconds. */
  clock?: () => number;
};

export type RetentionResult = {
  messages: number;
  /** `false` when the budget ran out with expired messages possibly left. */
  messagesDone: boolean;
  invites: number;
  devices: number;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_BUDGET_MS = 20_000;

/**
 * The hourly cleanup from `architecture/retention.mdx`:
 *
 * 1. Expired messages, in batches, until none are left or the budget is used up.
 *    Responses and read state go with them (`on delete cascade`).
 * 2. Invites that ended (accepted, revoked or expired) more than 30 days ago.
 * 3. Devices not seen for 60 days.
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

  let messages = 0;
  let messagesDone = false;
  while (clock() - startedAt < budgetMs) {
    // Uses `message_expiresAt_idx`.
    const deleted = await db
      .delete(message)
      .where(
        sql`${message.id} in (select "id" from "message" where "expires_at" < ${now.getTime()} limit ${batchSize})`,
      )
      .returning({ id: message.id });
    messages += deleted.length;
    if (deleted.length < batchSize) {
      messagesDone = true;
      break;
    }
  }

  const inviteCutoff = now.getTime() - ENDED_INVITE_KEEP_MS;
  const invites = await db
    .delete(invite)
    .where(
      // An invite ends when it is accepted or revoked, or else when it expires.
      sql`coalesce(${invite.acceptedAt}, ${invite.revokedAt}, ${invite.expiresAt}) < ${inviteCutoff}`,
    )
    .returning({ id: invite.id });

  const devices = await db
    .delete(device)
    .where(lt(device.lastSeenAt, new Date(now.getTime() - STALE_DEVICE_MS)))
    .returning({ id: device.id });

  return { messages, messagesDone, invites: invites.length, devices: devices.length };
}
