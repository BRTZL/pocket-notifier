import type { ConversationRef } from "@notifier/contract/conversation";
import { MessageId } from "@notifier/contract/message";
import { message, messageRead, project, projectMember } from "@notifier/db/schema/notifier";
import { and, eq, lt, lte, type SQL, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError } from "../lib/errors";
import {
  announcePublished,
  announceRead,
  notExpired,
  parseCursor,
  publishMessage,
  selectInbox,
  toInboxMessages,
  toMessage,
  toPage,
  toPublishOutput,
  unreadOnly,
} from "../lib/messages";
import { requireMember, requireMemberOf } from "../lib/project-access";

/** Messages of one conversation; matches `message_projectId_conversationKey_id_idx`. */
function inConversation(ref: ConversationRef) {
  return and(eq(message.projectId, ref.projectId), eq(message.conversationKey, ref.key));
}

const list = authed.messages.list.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  if (input.projectId) {
    await requireMember(db, input.projectId, userId);
  }
  const { conversation } = input;
  if (conversation && conversation.projectId !== input.projectId) {
    await requireMember(db, conversation.projectId, userId);
  }
  const cursor = parseCursor(MessageId, input.cursor);
  const rows = await selectInbox(db, userId, [
    input.projectId ? eq(message.projectId, input.projectId) : undefined,
    conversation ? inConversation(conversation) : undefined,
    input.unreadOnly ? unreadOnly() : undefined,
    cursor ? lt(message.id, cursor) : undefined,
  ]).limit(input.limit + 1);
  const page = toPage(
    rows,
    input.limit,
    (row) => row.message.id,
    (row) => row,
  );
  return { ...page, items: await toInboxMessages(db, userId, page.items) };
});

const get = authed.messages.get.handler(async ({ context, input }) => {
  const [row] = await selectInbox(context.db, context.session.user.id, [
    eq(message.id, input.id),
  ]).limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const [item] = await toInboxMessages(context.db, context.session.user.id, [row]);
  if (!item) {
    throw new Error("inbox message mapping returned no item");
  }
  return item;
});

const markRead = authed.messages.markRead.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  let filter: SQL | undefined;
  if ("ids" in input) {
    // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
    filter = sql`${message.id} in (select value from json_each(${JSON.stringify(input.ids)}))`;
  } else if ("upTo" in input) {
    filter = and(
      lte(message.id, input.upTo),
      input.projectId ? eq(message.projectId, input.projectId) : undefined,
    );
  } else {
    filter = inConversation(input.conversation);
  }

  const inserted = await db
    .insert(messageRead)
    .select(
      db
        .select({
          messageId: message.id,
          userId: sql<string>`${userId}`.as("user_id"),
          readAt: sql<number>`${Date.now()}`.as("read_at"),
        })
        .from(message)
        // Only messages the caller can see: non-expired, in a project they are a member of.
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, message.projectId), eq(projectMember.userId, userId)),
        )
        .where(and(notExpired(), filter)),
    )
    .onConflictDoNothing()
    .returning({ messageId: messageRead.messageId });
  // Only the newly marked ids: messages read before already had their dismiss sent.
  announceRead(
    context.dispatch,
    userId,
    inserted.map((row) => row.messageId),
  );
  return { updated: inserted.length };
});

const publish = authed.messages.publish.handler(async ({ context, input }) => {
  const { db } = context;
  const caller = context.session.user;
  const [found] = await db
    .select({ project, role: projectMember.role })
    .from(project)
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, caller.id)),
    )
    .where(eq(project.name, input.project))
    .limit(1);
  if (!found) {
    throw appError("NOT_FOUND", "Project not found");
  }
  if (found.role === "subscriber") {
    throw appError("FORBIDDEN", "Only owners and publishers can publish to this project");
  }
  const row = await publishMessage(db, {
    project: found.project,
    publisher: { userId: caller.id, tokenId: null },
    input,
  });
  announcePublished(context.dispatch, toMessage(row, found.project.name, caller));
  return toPublishOutput(row, found.project.name);
});

const remove = authed.messages.delete.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const [found] = await db
    .select({ projectId: message.projectId })
    .from(message)
    .where(and(eq(message.id, input.id), notExpired()))
    .limit(1);
  if (!found) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const membership = await requireMemberOf(db, found.projectId, userId, "Message not found");
  if (membership.role !== "owner") {
    throw appError("FORBIDDEN", "Only a project owner can delete messages");
  }
  await db.delete(message).where(eq(message.id, input.id));
  return { ok: true as const };
});

export const messagesRouter = authed.messages.router({
  list,
  get,
  markRead,
  publish,
  delete: remove,
});
