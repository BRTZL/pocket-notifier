import { Conversation, Sender } from "@notifier/contract/avatar";
import {
  type InboxMessage,
  type Message,
  MessageId,
  Message as MessageSchema,
  type PublishInput,
  Tag,
} from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { user } from "@notifier/db/schema/auth";
import { message, messageRead, topic, topicMember } from "@notifier/db/schema/notifier";
import { and, desc, eq, gt, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Dispatch } from "../dispatch";
import { badRequest } from "./errors";
import { toUserSummary } from "./serialize";
import { DAY_MS } from "./token-scope";

export type MessageRow = typeof message.$inferSelect;
type TopicRow = typeof topic.$inferSelect;
type UserRow = Parameters<typeof toUserSummary>[0];
type PublishFields = z.output<typeof PublishInput>;

const StoredTags = z.array(Tag);
const StoredActions = MessageSchema.shape.actions;
const StoredConversation = Conversation.nullable();
const StoredSender = Sender.nullable();

/** Gives every action a `key` (its own, or its index) and rejects duplicates. */
function normalizeActions(actions: PublishFields["actions"]): Message["actions"] {
  const keyed = actions.map((action, index) => ({ ...action, key: action.key ?? String(index) }));
  const seen = new Set<string>();
  for (const action of keyed) {
    if (seen.has(action.key)) {
      throw badRequest(`Duplicate action key "${action.key}". Each action needs its own key.`);
    }
    seen.add(action.key);
  }
  return keyed;
}

/**
 * Stores a message in `topic` and returns the stored row. Access checks are the
 * caller's job; this applies the topic's defaults and the shared publish rules.
 */
export async function publishMessage(
  db: Database,
  args: {
    topic: TopicRow;
    publisher: { userId: string; tokenId: string | null };
    input: PublishFields;
  },
): Promise<MessageRow> {
  const { topic: target, publisher, input } = args;
  if (input.attachmentId !== undefined) {
    throw badRequest("Attachments are not supported yet");
  }
  const actions = normalizeActions(input.actions);

  const now = new Date();
  const [row] = await db
    .insert(message)
    .values({
      id: newId("message"),
      topicId: target.id,
      title: input.title ?? null,
      body: input.body,
      priority: input.priority ?? target.defaultPriority,
      tagsJson: JSON.stringify(input.tags),
      clickUrl: input.clickUrl ?? null,
      actionsJson: JSON.stringify(actions),
      conversationJson: input.conversation ? JSON.stringify(input.conversation) : null,
      senderJson: input.sender ? JSON.stringify(input.sender) : null,
      publishedBy: publisher.userId,
      tokenId: publisher.tokenId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + target.retentionDays * DAY_MS),
    })
    .returning();
  if (!row) {
    throw new Error("message insert returned no row");
  }
  return row;
}

function parseStored<T extends z.ZodType>(
  schema: T,
  json: string | null,
  field: string,
  id: string,
): z.output<T> {
  let value: unknown = null;
  if (json !== null) {
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error(`message ${id} has an unreadable ${field}`);
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`message ${id} has an unreadable ${field}`);
  }
  return parsed.data;
}

/**
 * The contract `Message` for a stored row, parsed with the contract schema, so a
 * corrupt row fails loudly (a 500) instead of reaching a client or the push hook.
 */
export function toMessage(row: MessageRow, topicName: string, publisher: UserRow | null): Message {
  const assembled = {
    id: row.id,
    topicId: row.topicId,
    topic: topicName,
    title: row.title,
    body: row.body,
    priority: row.priority,
    tags: parseStored(StoredTags, row.tagsJson, "tags_json", row.id),
    clickUrl: row.clickUrl,
    actions: parseStored(StoredActions, row.actionsJson, "actions_json", row.id),
    attachment: null,
    conversation: parseStored(
      StoredConversation,
      row.conversationJson,
      "conversation_json",
      row.id,
    ),
    sender: parseStored(StoredSender, row.senderJson, "sender_json", row.id),
    publishedBy: publisher ? toUserSummary(publisher) : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
  const parsed = MessageSchema.safeParse(assembled);
  if (!parsed.success) {
    throw new Error(`message ${row.id} does not match the Message schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function toPublishOutput(row: MessageRow, topicName: string) {
  return {
    id: row.id,
    topic: topicName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Hands a stored message to the post-publish hook. The message is already saved, so a
 * failing hook is logged instead of failing the publish.
 */
export function announcePublished(dispatch: Dispatch, published: Message): void {
  try {
    dispatch.messagePublished(published);
  } catch (error) {
    console.error("dispatch.messagePublished failed", error);
  }
}

/** Not past its `expiresAt`. Expired messages are never shown, even before cleanup runs. */
export function notExpired(now: Date = new Date()): SQL {
  return gt(message.expiresAt, now);
}

/** Validates an opaque cursor; cursors are the id of the last item on the previous page. */
export function parseCursor<T extends z.ZodType<string>>(schema: T, cursor: string | undefined) {
  if (cursor === undefined) {
    return;
  }
  const parsed = schema.safeParse(cursor);
  if (!parsed.success) {
    throw badRequest("Invalid cursor");
  }
  return parsed.data;
}

/** Cuts a `limit + 1` result down to one page and derives `nextCursor` from its last item. */
export function toPage<Row, Item>(
  rows: Row[],
  limit: number,
  idOf: (row: Row) => string,
  toItem: (row: Row) => Item,
): { items: Item[]; nextCursor: string | null } {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last ? idOf(last) : null,
  };
}

/** Columns for a message with its topic name and publisher. */
const messageColumns = { message, topicName: topic.name, publisher: user };

/** One topic's non-expired messages, newest first: `limit + 1` rows from before `cursor`. */
export async function listTopicMessages(
  db: Database,
  args: { topicId: string; cursor?: string; since?: string; limit: number },
) {
  const cursor = parseCursor(MessageId, args.cursor);
  const rows = await db
    .select(messageColumns)
    .from(message)
    .innerJoin(topic, eq(topic.id, message.topicId))
    .leftJoin(user, eq(user.id, message.publishedBy))
    .where(
      and(
        eq(message.topicId, args.topicId),
        notExpired(),
        cursor ? lt(message.id, cursor) : undefined,
        args.since ? gt(message.createdAt, new Date(args.since)) : undefined,
      ),
    )
    .orderBy(desc(message.id))
    .limit(args.limit + 1);
  return toPage(
    rows,
    args.limit,
    (row) => row.message.id,
    (row) => toMessage(row.message, row.topicName, row.publisher),
  );
}

/** A non-expired message with its topic name and publisher, or `undefined`. */
export async function findMessage(db: Database, id: string) {
  const [row] = await db
    .select(messageColumns)
    .from(message)
    .innerJoin(topic, eq(topic.id, message.topicId))
    .leftJoin(user, eq(user.id, message.publishedBy))
    .where(and(eq(message.id, id), notExpired()))
    .limit(1);
  return row;
}

/**
 * Messages in the user's inbox (topics they are a member of), newest first, with
 * their read state. `extra` narrows it further, e.g. to one topic or one id.
 */
export function selectInbox(db: Database, userId: string, extra: (SQL | undefined)[]) {
  return db
    .select({ ...messageColumns, readAt: messageRead.readAt })
    .from(message)
    .innerJoin(topic, eq(topic.id, message.topicId))
    .innerJoin(
      topicMember,
      and(eq(topicMember.topicId, message.topicId), eq(topicMember.userId, userId)),
    )
    .leftJoin(user, eq(user.id, message.publishedBy))
    .leftJoin(
      messageRead,
      and(eq(messageRead.messageId, message.id), eq(messageRead.userId, userId)),
    )
    .where(and(notExpired(), ...extra))
    .orderBy(desc(message.id));
}

export function toInboxMessage(row: {
  message: MessageRow;
  topicName: string;
  publisher: UserRow | null;
  readAt: Date | null;
}): InboxMessage {
  return { ...toMessage(row.message, row.topicName, row.publisher), read: row.readAt !== null };
}

export const unreadOnly = () => isNull(messageRead.messageId);
