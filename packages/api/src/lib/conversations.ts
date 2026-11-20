import { Conversation, Sender } from "@notifier/contract/avatar";
import {
  CONVERSATION_PREVIEW_LENGTH,
  type ConversationRef,
  type ConversationSummary,
  ConversationSummary as ConversationSummarySchema,
  type OpenAsk,
} from "@notifier/contract/conversation";
import { MessageId } from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import {
  message,
  messageRead,
  messageResponse,
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
  args: { userId: string; cursor?: string; limit: number; only?: ConversationRef },
) {
  const { only } = args;
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
    .where(
      and(
        notExpired(),
        only
          ? and(eq(message.topicId, only.topicId), eq(message.conversationKey, only.key))
          : undefined,
      ),
    )
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

type SummaryRow = {
  message: MessageRow;
  key: string;
  unreadCount: number;
  topicName: string;
  topicDisplayName: string | null;
  muted: boolean | null;
};

/** `topicId` and conversation key as one string, to match rows against a page. */
function conversationId(topicId: string, key: string) {
  return `${topicId}\u001f${key}`;
}

/**
 * The open ask of each given conversation, in one query: candidate messages are the
 * non-expired ones of those conversations with a text reply action (`input: true`) the
 * caller has not answered. Newest message first, then its actions in order, so the
 * first candidate per conversation is its open ask. The topic filter keeps the search
 * on the `(topic_id, …)` indexes; the pair filter narrows it to the page.
 */
async function selectOpenAsks(
  db: Database,
  userId: string,
  conversations: { topicId: string; key: string }[],
): Promise<Map<string, OpenAsk>> {
  const asks = new Map<string, OpenAsk>();
  if (conversations.length === 0) {
    return asks;
  }
  const topicIds = [...new Set(conversations.map((row) => row.topicId))];
  const pairs = conversations.map((row) => conversationId(row.topicId, row.key));
  const action = sql`json_each(${message.actionsJson})`;
  const rows = await db
    .select({
      messageId: message.id,
      topicId: message.topicId,
      key: message.conversationKey,
      title: message.title,
      senderJson: message.senderJson,
      actionKey: sql<string>`json_extract(action.value, '$.key')`,
    })
    .from(message)
    .innerJoin(sql`${action} as action`, sql`1 = 1`)
    .where(
      and(
        notExpired(),
        sql`${message.topicId} in (select value from json_each(${JSON.stringify(topicIds)}))`,
        sql`${message.topicId} || char(31) || ${message.conversationKey} in (select value from json_each(${JSON.stringify(pairs)}))`,
        sql`json_extract(action.value, '$.type') = 'reply'`,
        sql`json_extract(action.value, '$.input') = 1`,
        sql`not exists (select 1 from ${messageResponse} where ${messageResponse.messageId} = ${message.id} and ${messageResponse.userId} = ${userId} and ${messageResponse.actionKey} = json_extract(action.value, '$.key'))`,
      ),
    )
    .orderBy(desc(message.id), sql`action.id`);
  for (const row of rows) {
    const id = conversationId(row.topicId, row.key);
    if (asks.has(id)) {
      continue;
    }
    const sender = parseStored(StoredSender, row.senderJson, "sender_json", row.messageId);
    asks.set(id, {
      messageId: row.messageId,
      actionKey: row.actionKey,
      senderName: sender ? (sender.name ?? sender.id) : null,
      title: row.title,
    });
  }
  return asks;
}

function toConversationSummary(row: SummaryRow, openAsk: OpenAsk | null): ConversationSummary {
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
    openAsk,
  };
  const parsed = ConversationSummarySchema.safeParse(assembled);
  if (!parsed.success) {
    throw new Error(`conversation ${row.key} of ${latest.topicId} does not match its schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Summaries for rows of `conversationsQuery`, with their open asks loaded in one query. */
async function toSummaries(db: Database, userId: string, rows: SummaryRow[]) {
  const asks = await selectOpenAsks(
    db,
    userId,
    rows.map((row) => ({ topicId: row.message.topicId, key: row.key })),
  );
  return rows.map((row) =>
    toConversationSummary(row, asks.get(conversationId(row.message.topicId, row.key)) ?? null),
  );
}

/** A page of the user's conversations; see `conversationsQuery`. */
export async function listConversations(
  db: Database,
  args: { userId: string; cursor?: string; limit: number },
) {
  const cursor = parseCursor(MessageId, args.cursor);
  const rows = await conversationsQuery(db, { ...args, cursor });
  const page = toPage(
    rows,
    args.limit,
    (row) => row.message.id,
    (row) => row,
  );
  return { ...page, items: await toSummaries(db, args.userId, page.items) };
}

/**
 * One conversation's summary for the user, or `undefined` when it has no non-expired
 * message in a topic they are a member of.
 */
export async function getConversation(db: Database, userId: string, ref: ConversationRef) {
  const [row] = await conversationsQuery(db, { userId, limit: 1, only: ref });
  if (!row) {
    return;
  }
  const [summary] = await toSummaries(db, userId, [row]);
  return summary;
}
