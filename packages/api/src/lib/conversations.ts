import { Conversation, Sender } from "@notifier/contract/avatar";
import {
  CONVERSATION_PREVIEW_LENGTH,
  type ConversationSummary,
  ConversationSummary as ConversationSummarySchema,
} from "@notifier/contract/conversation";
import { MessageId } from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import {
  message,
  messageRead,
  subscription,
  topic,
  topicMember,
} from "@notifier/db/schema/notifier";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import { notExpired, parseCursor, parseStored, toPage } from "./messages";

type MessageRow = typeof message.$inferSelect;

const StoredConversation = Conversation.nullable();
const StoredSender = Sender.nullable();

/**
 * One row per conversation in the user's topics, newest last message first, from
 * before `cursor` (a last message id). `limit + 1` rows, for `toPage`.
 *
 * The inner query groups the user's non-expired messages by `(topic_id,
 * conversation_key)` and keeps the newest id (ids are ULIDs) and the unread count.
 * GROUP BY with `max(id)` rather than a window or a correlated subquery: the unread
 * count needs every non-expired message of the group anyway, so one pass does both.
 * The outer query joins that newest id back to its row for the preview, the
 * conversation JSON and the sender.
 *
 * Plan (`EXPLAIN QUERY PLAN` test): member topics by `topic_member_userId_idx`, their
 * messages by a `(topic_id, …)` index search, reads by primary key, then temp b-trees
 * to group and order the user's rows. No full scan of `message`. The cost grows with
 * the user's non-expired messages, which retention bounds.
 */
export function conversationsQuery(
  db: Database,
  args: { userId: string; cursor?: string; limit: number },
) {
  const { userId } = args;
  const groups = db
    .select({
      topicId: message.topicId,
      key: message.conversationKey,
      lastId: sql<string>`max(${message.id})`.as("last_id"),
      unreadCount: sql<number>`count(*) - count(${messageRead.messageId})`.as("unread_count"),
    })
    .from(message)
    .innerJoin(
      topicMember,
      and(eq(topicMember.topicId, message.topicId), eq(topicMember.userId, userId)),
    )
    .leftJoin(
      messageRead,
      and(eq(messageRead.messageId, message.id), eq(messageRead.userId, userId)),
    )
    .where(notExpired())
    .groupBy(message.topicId, message.conversationKey)
    .as("conversation");

  return db
    .select({
      message,
      key: groups.key,
      unreadCount: groups.unreadCount,
      topicName: topic.name,
      topicDisplayName: topic.displayName,
      muted: subscription.muted,
    })
    .from(groups)
    .innerJoin(message, eq(message.id, groups.lastId))
    .innerJoin(topic, eq(topic.id, groups.topicId))
    .leftJoin(
      subscription,
      and(eq(subscription.topicId, groups.topicId), eq(subscription.userId, userId)),
    )
    .where(args.cursor ? lt(groups.lastId, args.cursor) : undefined)
    .orderBy(desc(groups.lastId))
    .limit(args.limit + 1);
}

const WHITESPACE = /\s+/gu;
const ELLIPSIS = "…";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The body on one line, cut to the preview length (ellipsis included) at a grapheme
 * boundary, so a flag or a ZWJ emoji is kept whole or left out, never split.
 */
export function previewOf(body: string) {
  const line = body.replace(WHITESPACE, " ").trim();
  if (line.length <= CONVERSATION_PREVIEW_LENGTH) {
    return line;
  }
  const room = CONVERSATION_PREVIEW_LENGTH - ELLIPSIS.length;
  let cut = 0;
  for (const { index, segment } of graphemes.segment(line)) {
    if (index + segment.length > room) {
      break;
    }
    cut = index + segment.length;
  }
  return `${line.slice(0, cut).trimEnd()}${ELLIPSIS}`;
}

function toConversationSummary(row: {
  message: MessageRow;
  key: string;
  unreadCount: number;
  topicName: string;
  topicDisplayName: string | null;
  muted: boolean | null;
}): ConversationSummary {
  const latest = row.message;
  const isConversation = row.key.startsWith("c:");
  const conversation = isConversation
    ? parseStored(StoredConversation, latest.conversationJson, "conversation_json", latest.id)
    : null;
  const sender = parseStored(StoredSender, latest.senderJson, "sender_json", latest.id);
  const assembled = {
    topicId: latest.topicId,
    topic: row.topicName,
    key: row.key,
    title:
      conversation?.title ??
      conversation?.id ??
      (isConversation ? row.key.slice(2) : (row.topicDisplayName ?? row.topicName)),
    iconUrl: conversation?.iconUrl ?? null,
    kind: isConversation ? "conversation" : "topic",
    lastMessage: {
      id: latest.id,
      title: latest.title,
      body: previewOf(latest.body),
      senderName: sender ? (sender.name ?? sender.id) : null,
      priority: latest.priority,
      createdAt: latest.createdAt.toISOString(),
    },
    unreadCount: Number(row.unreadCount),
    muted: row.muted ?? false,
  };
  const parsed = ConversationSummarySchema.safeParse(assembled);
  if (!parsed.success) {
    throw new Error(`conversation ${row.key} of ${latest.topicId} does not match its schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** A page of the user's conversations; see `conversationsQuery`. */
export async function listConversations(
  db: Database,
  args: { userId: string; cursor?: string; limit: number },
) {
  const cursor = parseCursor(MessageId, args.cursor);
  const rows = await conversationsQuery(db, { ...args, cursor });
  return toPage(rows, args.limit, (row) => row.message.id, toConversationSummary);
}
