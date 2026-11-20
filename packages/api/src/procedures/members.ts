import type { Database } from "@notifier/db";
import { projectMember, subscription } from "@notifier/db/schema/notifier";
import { and, eq, ne, notExists, or, type SQL, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError, isUniqueViolation } from "../lib/errors";
import { requireMember, requireNotPersonal, requireOwner } from "../lib/project-access";
import { toProjectMember } from "../lib/serialize";

const LAST_OWNER_MESSAGE =
  "A project needs at least one owner. Make someone else an owner first, or delete the project.";

function memberWhere(projectId: string, userId: string): SQL | undefined {
  return and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId));
}

/**
 * True for a non-owner row, or while the project has another owner. Used inside the
 * write itself so two concurrent requests cannot remove the last owner between them.
 */
function notLastOwner(projectId: string): SQL | undefined {
  return or(
    ne(projectMember.role, "owner"),
    sql`(select count(*) from ${projectMember} as owners where owners.project_id = ${projectId} and owners.role = 'owner') > 1`,
  );
}

async function loadMember(db: Database, projectId: string, userId: string) {
  const row = await db.query.projectMember.findFirst({
    where: { projectId, userId },
    with: { user: true },
  });
  if (!row) {
    throw appError("NOT_FOUND", "Member not found");
  }
  return row;
}

async function countOwners(db: Database, projectId: string): Promise<number> {
  return await db.$count(
    projectMember,
    and(eq(projectMember.projectId, projectId), eq(projectMember.role, "owner")),
  );
}

const list = authed.members.list.handler(async ({ context, input }) => {
  await requireMember(context.db, input.projectId, context.session.user.id);
  const rows = await context.db.query.projectMember.findMany({
    where: { projectId: input.projectId },
    with: { user: true },
    orderBy: { addedAt: "asc", userId: "asc" },
  });
  return rows.map(toProjectMember);
});

const add = authed.members.add.handler(async ({ context, input, errors }) => {
  const { db } = context;
  await requireOwner(db, input.projectId, context.session.user.id);
  await requireNotPersonal(db, input.projectId);

  // better-auth stores emails in lowercase.
  const target = await db.query.user.findFirst({ where: { email: input.email.toLowerCase() } });
  if (!target) {
    throw errors.NOT_FOUND({ message: "No user with this email. Invite them first." });
  }
  const existing = await db.query.projectMember.findFirst({
    where: { projectId: input.projectId, userId: target.id },
  });
  if (existing) {
    throw errors.CONFLICT({ message: "This user is already a member of the project" });
  }

  try {
    const [[inserted]] = await db.batch([
      db
        .insert(projectMember)
        .values({ projectId: input.projectId, userId: target.id, role: input.role })
        .returning(),
      db
        .insert(subscription)
        .values({ projectId: input.projectId, userId: target.id, muted: false })
        .onConflictDoNothing(),
    ]);
    if (!inserted) {
      throw new Error("member insert returned no row");
    }
    return toProjectMember({ ...inserted, user: target });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.CONFLICT({ message: "This user is already a member of the project" });
    }
    throw error;
  }
});

const update = authed.members.update.handler(async ({ context, input }) => {
  const { db } = context;
  await requireOwner(db, input.projectId, context.session.user.id);
  const current = await loadMember(db, input.projectId, input.userId);
  if (current.role === input.role) {
    return toProjectMember(current);
  }

  const demotesOwner = current.role === "owner";
  if (demotesOwner && (await countOwners(db, input.projectId)) <= 1) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }

  const [updated] = await db
    .update(projectMember)
    .set({ role: input.role })
    .where(
      and(
        memberWhere(input.projectId, input.userId),
        // Guard every demotion, not just ones that looked like an owner when read:
        // the target may have become the sole owner since.
        input.role === "owner" ? undefined : notLastOwner(input.projectId),
      ),
    )
    .returning();
  if (!updated) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }
  return toProjectMember({ ...updated, user: current.user });
});

const remove = authed.members.remove.handler(async ({ context, input }) => {
  const { db } = context;
  const callerId = context.session.user.id;
  const caller = await requireMember(db, input.projectId, callerId);
  const leaving = input.userId === callerId;
  if (!leaving && caller.role !== "owner") {
    throw appError("FORBIDDEN", "Only a project owner can remove other members");
  }

  const target = leaving ? caller : await loadMember(db, input.projectId, input.userId);
  if (target.role === "owner" && (await countOwners(db, input.projectId)) <= 1) {
    throw appError("FORBIDDEN", LAST_OWNER_MESSAGE);
  }

  const [deleted] = await db.batch([
    db
      .delete(projectMember)
      .where(and(memberWhere(input.projectId, input.userId), notLastOwner(input.projectId)))
      .returning({ userId: projectMember.userId }),
    // Only drops the subscription once the membership is really gone.
    db
      .delete(subscription)
      .where(
        and(
          eq(subscription.projectId, input.projectId),
          eq(subscription.userId, input.userId),
          notExists(
            db
              .select({ one: sql`1` })
              .from(projectMember)
              .where(memberWhere(input.projectId, input.userId)),
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
