import { findOpenInvite, parseGrants } from "@notifier/auth/invites";
import { newId } from "@notifier/db/ids";
import { invite, topic, topicMember } from "@notifier/db/schema/notifier";
import { randomBase62, sha256Hex } from "@notifier/db/secrets";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { authed, os } from "../base";
import { appError } from "../lib/errors";
import { toInvite } from "../lib/serialize";
import { DAY_MS } from "../lib/token-scope";
import { requireNotPersonal } from "../lib/topic-access";

const CODE_LENGTH = 24;

const list = authed.invites.list.handler(async ({ context }) => {
  const rows = await context.db.query.invite.findMany({
    where: { createdBy: context.session.user.id },
    with: { creator: true, acceptor: true },
    orderBy: { createdAt: "desc", id: "desc" },
  });
  return rows.map((row) => toInvite(row, parseGrants(row.grantsJson)));
});

const create = authed.invites.create.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const topicIds = input.grants.map((grant) => grant.topicId);
  if (new Set(topicIds).size !== topicIds.length) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Each topic can appear only once in an invite's grants",
    });
  }
  if (topicIds.length > 0) {
    const memberships = await db
      .select({ topicId: topicMember.topicId, role: topicMember.role })
      .from(topicMember)
      .where(and(eq(topicMember.userId, userId), inArray(topicMember.topicId, topicIds)));
    const roles = new Map(memberships.map((found) => [found.topicId, found.role]));
    for (const topicId of topicIds) {
      const role = roles.get(topicId);
      if (!role) {
        throw appError("NOT_FOUND", "Topic not found");
      }
      if (role !== "owner") {
        throw appError("FORBIDDEN", "Only a topic owner can invite people to it");
      }
      await requireNotPersonal(db, topicId);
    }
  }

  const code = randomBase62(CODE_LENGTH);
  const id = newId("invite");
  await db.insert(invite).values({
    id,
    createdBy: userId,
    codeHash: await sha256Hex(code),
    email: input.email?.toLowerCase() ?? null,
    grantsJson: JSON.stringify(input.grants),
    expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
  });
  const row = await db.query.invite.findFirst({
    where: { id },
    with: { creator: true, acceptor: true },
  });
  if (!row) {
    throw new Error("invite insert returned no row");
  }
  return {
    invite: toInvite(row, input.grants),
    code,
    url: `${context.appUrl}/invite/${code}`,
  };
});

const revoke = authed.invites.revoke.handler(async ({ context, input }) => {
  const [row] = await context.db
    .update(invite)
    .set({ revokedAt: sql`coalesce(${invite.revokedAt}, ${Date.now()})` })
    .where(
      and(
        eq(invite.id, input.id),
        eq(invite.createdBy, context.session.user.id),
        isNull(invite.acceptedAt),
      ),
    )
    .returning({ id: invite.id });
  if (!row) {
    throw appError("NOT_FOUND", "Invite not found");
  }
  return { ok: true as const };
});

/** No session: the sign-up page shows this before the person has an account. */
const preview = os.invites.preview.handler(async ({ context, input }) => {
  const { db } = context;
  const open = await findOpenInvite(db, input.code);
  const creator = open ? await db.query.user.findFirst({ where: { id: open.createdBy } }) : null;
  if (!(open && creator)) {
    throw appError("NOT_FOUND", "Invite not found");
  }
  const topicIds = parseGrants(open.grantsJson).map((grant) => grant.topicId);
  const topics =
    topicIds.length === 0
      ? []
      : // Same rule as accepting: only topics that exist and the inviter still owns.
        await db
          .select({ name: topic.name })
          .from(topic)
          .innerJoin(
            topicMember,
            and(
              eq(topicMember.topicId, topic.id),
              eq(topicMember.userId, open.createdBy),
              eq(topicMember.role, "owner"),
            ),
          )
          .where(inArray(topic.id, topicIds))
          .orderBy(topic.name);
  return {
    invitedBy: creator.name,
    email: open.email,
    topics: topics.map((row) => row.name),
    expiresAt: open.expiresAt.toISOString(),
  };
});

// `os`, not `authed`: a router built from `authed` would put `preview` behind the
// session check too. The other procedures already carry it.
export const invitesRouter = os.invites.router({ list, create, revoke, preview });
