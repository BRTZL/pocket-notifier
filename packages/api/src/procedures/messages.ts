import { MessageId } from "@notifier/contract/message";
import { message, messageRead, topic, topicMember } from "@notifier/db/schema/notifier";
import { and, eq, lt, lte, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError } from "../lib/errors";
import {
  announcePublished,
  notExpired,
  parseCursor,
  publishMessage,
  selectInbox,
  toInboxMessage,
  toMessage,
  toPage,
  toPublishOutput,
  unreadOnly,
} from "../lib/messages";
import { requireMember, requireMemberOf } from "../lib/topic-access";

const list = authed.messages.list.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  if (input.topicId) {
    await requireMember(db, input.topicId, userId);
  }
  const cursor = parseCursor(MessageId, input.cursor);
  const rows = await selectInbox(db, userId, [
    input.topicId ? eq(message.topicId, input.topicId) : undefined,
    input.unreadOnly ? unreadOnly() : undefined,
    cursor ? lt(message.id, cursor) : undefined,
  ]).limit(input.limit + 1);
  return toPage(rows, input.limit, (row) => row.message.id, toInboxMessage);
});

const get = authed.messages.get.handler(async ({ context, input }) => {
  const [row] = await selectInbox(context.db, context.session.user.id, [
    eq(message.id, input.id),
  ]).limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Message not found");
  }
  return toInboxMessage(row);
});

const markRead = authed.messages.markRead.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const filter =
    "ids" in input
      ? // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
        sql`${message.id} in (select value from json_each(${JSON.stringify(input.ids)}))`
      : and(
          lte(message.id, input.upTo),
          input.topicId ? eq(message.topicId, input.topicId) : undefined,
        );

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
