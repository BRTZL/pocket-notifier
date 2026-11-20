import type { Database } from "@notifier/db";
import { subscription, topicMember } from "@notifier/db/schema/notifier";
import { and, eq, ne, notExists, or, type SQL, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError, isUniqueViolation } from "../lib/errors";
import { toTopicMember } from "../lib/serialize";
import { requireMember, requireNotPersonal, requireOwner } from "../lib/topic-access";

const LAST_OWNER_MESSAGE =
  "A topic needs at least one owner. Make someone else an owner first, or delete the topic.";

function memberWhere(topicId: string, userId: string): SQL | undefined {
  return and(eq(topicMember.topicId, topicId), eq(topicMember.userId, userId));
}

/**
 * True for a non-owner row, or while the topic has another owner. Used inside the
 * write itself so two concurrent requests cannot remove the last owner between them.
 */
function notLastOwner(topicId: string): SQL | undefined {
  return or(
    ne(topicMember.role, "owner"),
    sql`(select count(*) from ${topicMember} as owners where owners.topic_id = ${topicId} and owners.role = 'owner') > 1`,
  );
}

async function loadMember(db: Database, topicId: string, userId: string) {
  const row = await db.query.topicMember.findFirst({
    where: { topicId, userId },
    with: { user: true },
  });
  if (!row) {
    throw appError("NOT_FOUND", "Member not found");
  }
  return row;
}

async function countOwners(db: Database, topicId: string): Promise<number> {
  return await db.$count(
    topicMember,
    and(eq(topicMember.topicId, topicId), eq(topicMember.role, "owner")),
  );
}

const list = authed.members.list.handler(async ({ context, input }) => {
  await requireMember(context.db, input.topicId, context.session.user.id);
  const rows = await context.db.query.topicMember.findMany({
    where: { topicId: input.topicId },
    with: { user: true },
    orderBy: { addedAt: "asc", userId: "asc" },
  });
  return rows.map(toTopicMember);
});

const add = authed.members.add.handler(async ({ context, input, errors }) => {
  const { db } = context;
  await requireOwner(db, input.topicId, context.session.user.id);
  await requireNotPersonal(db, input.topicId);

  // better-auth stores emails in lowercase.
  const target = await db.query.user.findFirst({ where: { email: input.email.toLowerCase() } });
  if (!target) {
    throw errors.NOT_FOUND({ message: "No user with this email. Invite them first." });
  }
  const existing = await db.query.topicMember.findFirst({
    where: { topicId: input.topicId, userId: target.id },
  });
  if (existing) {
    throw errors.CONFLICT({ message: "This user is already a member of the topic" });
  }

  try {
    const [[inserted]] = await db.batch([
      db
        .insert(topicMember)
        .values({ topicId: input.topicId, userId: target.id, role: input.role })
        .returning(),
      db
        .insert(subscription)
        .values({ topicId: input.topicId, userId: target.id, muted: false })
        .onConflictDoNothing(),
    ]);
    if (!inserted) {
      throw new Error("member insert returned no row");
    }
    return toTopicMember({ ...inserted, user: target });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.CONFLICT({ message: "This user is already a member of the topic" });
    }
    throw error;
  }
});

const update = authed.members.update.handler(async ({ context, input }) => {
  const { db } = context;
  await requireOwner(db, input.topicId, context.session.user.id);
  const current = await loadMember(db, input.topicId, input.userId);
  if (current.role === input.role) {
    return toTopicMember(current);
  }

  const demotesOwner = current.role === "owner";
  if (demotesOwner && (await countOwners(db, input.topicId)) <= 1) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }

  const [updated] = await db
    .update(topicMember)
    .set({ role: input.role })
    .where(
      and(
        memberWhere(input.topicId, input.userId),
        // Guard every demotion, not just ones that looked like an owner when read:
        // the target may have become the sole owner since.
        input.role === "owner" ? undefined : notLastOwner(input.topicId),
      ),
    )
    .returning();
  if (!updated) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }
  return toTopicMember({ ...updated, user: current.user });
});

const remove = authed.members.remove.handler(async ({ context, input }) => {
  const { db } = context;
  const callerId = context.session.user.id;
  const caller = await requireMember(db, input.topicId, callerId);
  const leaving = input.userId === callerId;
  if (!leaving && caller.role !== "owner") {
    throw appError("FORBIDDEN", "Only a topic owner can remove other members");
  }

  const target = leaving ? caller : await loadMember(db, input.topicId, input.userId);
  if (target.role === "owner" && (await countOwners(db, input.topicId)) <= 1) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }

  const [deleted] = await db.batch([
    db
      .delete(topicMember)
      .where(and(memberWhere(input.topicId, input.userId), notLastOwner(input.topicId)))
      .returning({ userId: topicMember.userId }),
    // Only drops the subscription once the membership is really gone.
    db
      .delete(subscription)
      .where(
        and(
          eq(subscription.topicId, input.topicId),
          eq(subscription.userId, input.userId),
          notExists(
            db
              .select({ one: sql`1` })
              .from(topicMember)
              .where(memberWhere(input.topicId, input.userId)),
          ),
        ),
      ),
  ]);
  if (deleted.length === 0) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }
  return { ok: true as const };
});

export const membersRouter = authed.members.router({ list, add, update, remove });
