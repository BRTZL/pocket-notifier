import { InviteCode, InviteTopicGrant } from "@notifier/contract/invite";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { invite, subscription, topic, topicMember } from "@notifier/db/schema/notifier";
import { sha256Hex } from "@notifier/db/secrets";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export type InviteRow = typeof invite.$inferSelect;
export type InviteGrant = z.infer<typeof InviteTopicGrant>;

const Grants = z.array(InviteTopicGrant);

/** Parses `invite.grants_json`. Unreadable data counts as no grants rather than failing. */
export function parseGrants(json: string): InviteGrant[] {
  try {
    const parsed = Grants.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * The invite for `code` if it can still be accepted: it exists, and is not expired,
 * revoked or accepted. Anything that is not a well-formed code returns `null`.
 */
export async function findOpenInvite(
  db: Database,
  code: unknown,
  now: Date = new Date(),
): Promise<InviteRow | null> {
  const parsed = InviteCode.safeParse(code);
  if (!parsed.success) {
    return null;
  }
  const [row] = await db
    .select()
    .from(invite)
    .where(
      and(
        eq(invite.codeHash, await sha256Hex(parsed.data)),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** True when the invite is not locked to an email, or locked to this one (any case). */
export function inviteAllowsEmail(row: Pick<InviteRow, "email">, email: string): boolean {
  return row.email === null || row.email.toLowerCase() === email.toLowerCase();
}

/** True when the database has no users yet, so the first sign-up needs no invite. */
export async function hasNoUsers(db: Database): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1);
  return rows.length === 0;
}

/**
 * Marks the invite accepted by `userId` and applies its grants (membership with the
 * granted role plus an unmuted subscription, for each granted topic that still exists).
 *
 * Runs as one D1 batch, which is a single transaction. The UPDATE only matches an
 * invite that is still open, and every INSERT is gated on the invite now being
 * accepted by this user, so a code used twice concurrently grants access only once.
 * Returns `false` when the invite could not be claimed.
 */
export async function consumeInvite(
  db: Database,
  inviteId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [current] = await db
    .select({ grantsJson: invite.grantsJson })
    .from(invite)
    .where(eq(invite.id, inviteId))
    .limit(1);
  if (!current) {
    return false;
  }
  const grants = parseGrants(current.grantsJson);

  const claimedByUser = sql`exists (select 1 from ${invite} where ${invite.id} = ${inviteId} and ${invite.acceptedBy} = ${userId})`;
  const grantInserts = grants.flatMap((grant) => [
    db
      .insert(topicMember)
      .select(
        db
          .select({
            topicId: topic.id,
            userId: sql<string>`${userId}`.as("user_id"),
            role: sql<InviteGrant["role"]>`${grant.role}`.as("role"),
          })
          .from(topic)
          .where(and(eq(topic.id, grant.topicId), claimedByUser)),
      )
      .onConflictDoNothing(),
    db
      .insert(subscription)
      .select(
        db
          .select({
            topicId: topic.id,
            userId: sql<string>`${userId}`.as("user_id"),
            muted: sql<boolean>`0`.as("muted"),
          })
          .from(topic)
          .where(and(eq(topic.id, grant.topicId), claimedByUser)),
      )
      .onConflictDoNothing(),
  ]);

  const [claimed] = await db.batch([
    db
      .update(invite)
      .set({ acceptedAt: now, acceptedBy: userId })
      .where(
        and(
          eq(invite.id, inviteId),
          isNull(invite.acceptedAt),
          isNull(invite.revokedAt),
          gt(invite.expiresAt, now),
        ),
      )
      .returning({ id: invite.id }),
    ...grantInserts,
  ]);
  return claimed.length > 0;
}
