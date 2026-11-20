import type { ConversationRef } from "@notifier/contract/conversation";
import { MessageId } from "@notifier/contract/message";
import { message, messageRead, topic, topicMember } from "@notifier/db/schema/notifier";
import { and, eq, lt, lte, type SQL, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError } from "../lib/errors";
import {
  announcePublished,
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
import { requireMember, requireMemberOf } from "../lib/topic-access";

/** Messages of one conversation; matches `message_topicId_conversationKey_id_idx`. */
function inConversation(ref: ConversationRef) {
  return and(eq(message.topicId, ref.topicId), eq(message.conversationKey, ref.key));
}

const list = authed.messages.list.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  if (input.topicId) {
    await requireMember(db, input.topicId, userId);
  }
  const { conversation } = input;
  if (conversation && conversation.topicId !== input.topicId) {
    await requireMember(db, conversation.topicId, userId);
  }
  const cursor = parseCursor(MessageId, input.cursor);
  const rows = await selectInbox(db, userId, [
    input.topicId ? eq(message.topicId, input.topicId) : undefined,
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
      input.topicId ? eq(message.topicId, input.topicId) : undefined,
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
        // Only messages the caller can see: non-expired, in a topic they are a member of.
        .innerJoin(
          topicMember,
          and(eq(topicMember.topicId, message.topicId), eq(topicMember.userId, userId)),
        )
        .where(and(notExpired(), filter)),
    )
    .onConflictDoNothing()
    .returning({ messageId: messageRead.messageId });
  return { updated: inserted.length };
});

const publish = authed.messages.publish.handler(async ({ context, input }) => {
  const { db } = context;
  const caller = context.session.user;
  const [found] = await db
    .select({ topic, role: topicMember.role })
    .from(topic)
    .innerJoin(
      topicMember,
      and(eq(topicMember.topicId, topic.id), eq(topicMember.userId, caller.id)),
    )
    .where(eq(topic.name, input.topic))
    .limit(1);
  if (!found) {
    throw appError("NOT_FOUND", "Topic not found");
  }
  if (found.role === "subscriber") {
    throw appError("FORBIDDEN", "Only owners and publishers can publish to this topic");
  }
  const row = await publishMessage(db, {
    topic: found.topic,
    publisher: { userId: caller.id, tokenId: null },
    input,
  });
  announcePublished(context.dispatch, toMessage(row, found.topic.name, caller));
  return toPublishOutput(row, found.topic.name);
});

const remove = authed.messages.delete.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const [found] = await db
    .select({ topicId: message.topicId })
    .from(message)
    .where(and(eq(message.id, input.id), notExpired()))
    .limit(1);
  if (!found) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const membership = await requireMemberOf(db, found.topicId, userId, "Message not found");
  if (membership.role !== "owner") {
    throw appError("FORBIDDEN", "Only a topic owner can delete messages");
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
