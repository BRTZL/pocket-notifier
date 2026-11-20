import { InviteCode, InviteProjectGrant } from "@notifier/contract/invite";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { invite, project, projectMember, subscription } from "@notifier/db/schema/notifier";
import { sha256Hex } from "@notifier/db/secrets";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export type InviteRow = typeof invite.$inferSelect;
export type InviteGrant = z.infer<typeof InviteProjectGrant>;

const Grants = z.array(InviteProjectGrant);

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
    .where(and(eq(invite.codeHash, await sha256Hex(parsed.data)), isOpen(now)))
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

/** Every SQL condition for an invite that can still be accepted. */
function isOpen(now: Date) {
  return and(isNull(invite.acceptedAt), isNull(invite.revokedAt), gt(invite.expiresAt, now));
}

/**
 * Atomically claims an open invite before its user exists: sets `accepted_at` only if
 * the invite is still open, so of two concurrent sign-ups with one code only one gets
 * `true`. `accepted_by` stays NULL until `finalizeInvite` links the new user.
 */
export async function claimInvite(
  db: Database,
  inviteId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const claimed = await db
    .update(invite)
    .set({ acceptedAt: now })
    .where(and(eq(invite.id, inviteId), isOpen(now)))
    .returning({ id: invite.id });
  return claimed.length > 0;
}

/**
 * Gives a claim back after the sign-up that made it failed before creating the user.
 * Only touches a claim that no user has been linked to yet.
 */
export async function releaseInvite(db: Database, inviteId: string): Promise<void> {
  await db
    .update(invite)
    .set({ acceptedAt: null })
    .where(and(eq(invite.id, inviteId), isNull(invite.acceptedBy)));
}

/**
 * Links a claimed invite to the user created with it and applies its grants: a
 * membership with the granted role plus an unmuted subscription, for each granted
 * project that still exists and that the inviter still owns.
 *
 * One D1 batch, which is a single transaction. Every INSERT is gated in SQL on the
 * invite now being accepted by this user and on the inviter's current ownership, so
 * a stale grant or a second finalize for the same invite inserts nothing.
 * Returns `false` when the invite was not claimed or is already linked to a user.
 */
export async function finalizeInvite(
  db: Database,
  inviteId: string,
  userId: string,
): Promise<boolean> {
  const [current] = await db
    .select({ grantsJson: invite.grantsJson })
    .from(invite)
    .where(eq(invite.id, inviteId))
    .limit(1);
  if (!current) {
    return false;
  }

  const grantable = sql`exists (
    select 1 from ${invite}
    inner join ${projectMember} as inviter
      on inviter.user_id = ${invite.createdBy} and inviter.project_id = ${project.id}
    where ${invite.id} = ${inviteId} and ${invite.acceptedBy} = ${userId}
      and inviter.role = 'owner'
  )`;
  const grantInserts = parseGrants(current.grantsJson).flatMap((grant) => [
    db
      .insert(projectMember)
      .select(
        db
          .select({
            projectId: project.id,
            userId: sql<string>`${userId}`.as("user_id"),
            role: sql<InviteGrant["role"]>`${grant.role}`.as("role"),
          })
          .from(project)
          .where(and(eq(project.id, grant.projectId), grantable)),
      )
      .onConflictDoNothing(),
    db
      .insert(subscription)
      .select(
        db
          .select({
            projectId: project.id,
            userId: sql<string>`${userId}`.as("user_id"),
            muted: sql<boolean>`0`.as("muted"),
          })
          .from(project)
          .where(and(eq(project.id, grant.projectId), grantable)),
      )
      .onConflictDoNothing(),
  ]);

  const [linked] = await db.batch([
    db
      .update(invite)
      .set({ acceptedBy: userId })
      .where(and(eq(invite.id, inviteId), isNotNull(invite.acceptedAt), isNull(invite.acceptedBy)))
      .returning({ id: invite.id }),
    ...grantInserts,
  ]);
  return linked.length > 0;
}
