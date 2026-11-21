import { Conversation, Sender } from "@notifier/contract/avatar";
import {
  type Attachment,
  type InboxMessage,
  type Message,
  MessageId,
  Message as MessageSchema,
  type MyResponse,
  type PublishInput,
  Tag,
} from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { user } from "@notifier/db/schema/auth";
import {
  attachment,
  message,
  messageRead,
  messageResponse,
  project,
  projectMember,
} from "@notifier/db/schema/notifier";
import { and, asc, desc, eq, getTableColumns, gt, isNull, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Dispatch } from "../dispatch";
import {
  type AttachmentRow,
  type AttachTarget,
  attachableUpload,
  attachableWhere,
  attachmentOf,
  linkAttachment,
} from "./attachments";
import { badRequest } from "./errors";
import { ensureFeature, touchFeature } from "./features";
import { toUserSummary } from "./serialize";
import { DAY_MS } from "./token-scope";

export type MessageRow = typeof message.$inferSelect;
/** A stored message with the attachment linked to it, if any. */
export type PublishedRow = { message: MessageRow; attachment: AttachmentRow | null };
type ProjectRow = typeof project.$inferSelect;
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
 * Stores a message in `project` and returns the stored row. Access checks are the
 * caller's job; this applies the project's defaults and the shared publish rules.
 *
 * Every conversation is a feature: a message with `conversation` is filed under the
 * project's feature for it (found or created by `ensureFeature`), stored with
 * `conversation = { id: slug, title: name }` so its thread key is `c:<slug>`, and moves
 * that feature's `last_message_at`. Without `conversation` it goes to the project-level
 * thread, `p:<project id>`.
 *
 * With `attachmentId`, the upload (uploaded, same project, not yet attached) is linked to
 * the message in the same batch as the insert and takes the message's `expiresAt`.
 */
export async function publishMessage(
  db: Database,
  args: {
    project: ProjectRow;
    publisher: { userId: string; tokenId: string | null };
    input: PublishFields;
  },
): Promise<PublishedRow> {
  const { project: target, publisher, input } = args;
  const actions = normalizeActions(input.actions);
  const now = new Date();
  const attach =
    input.attachmentId === undefined
      ? undefined
      : {
          attachmentId: input.attachmentId,
          projectId: target.id,
          userId: publisher.userId,
          now,
        };
  if (attach) {
    await attachableUpload(db, attach);
  }
  const { featureRow, conversation } = await fileUnderFeature(db, {
    projectId: target.id,
    userId: publisher.userId,
    input,
  });
  const published = await storeMessage(
    db,
    {
      id: newId("message"),
      projectId: target.id,
      title: input.title ?? null,
      body: input.body,
      priority: input.priority ?? target.defaultPriority,
      tagsJson: JSON.stringify(input.tags),
      clickUrl: input.clickUrl ?? null,
      actionsJson: JSON.stringify(actions),
      conversationJson: conversation ? JSON.stringify(conversation) : null,
      senderJson: input.sender ? JSON.stringify(input.sender) : null,
      conversationKey: featureRow ? `c:${featureRow.slug}` : `p:${target.id}`,
      publishedBy: publisher.userId,
      tokenId: publisher.tokenId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + target.retentionDays * DAY_MS),
    },
    attach,
  );
  if (featureRow && !(await touchFeature(db, featureRow.id, published.message.createdAt))) {
    // Retention deleted the (idle, empty) feature between `ensureFeature` and the insert.
    // The message now exists, so a feature created again here is never deleted under it.
    const { feature: again } = await ensureFeature(db, {
      projectId: target.id,
      key: featureRow.slug,
      name: featureRow.name,
      userId: publisher.userId,
    });
    await touchFeature(db, again.id, published.message.createdAt);
  }
  return published;
}

/** The feature a message with `conversation` belongs to, and the conversation it stores. */
async function fileUnderFeature(
  db: Database,
  args: { projectId: string; userId: string; input: PublishFields },
) {
  const requested = args.input.conversation;
  if (!requested) {
    return { featureRow: undefined, conversation: null };
  }
  const { feature: featureRow } = await ensureFeature(db, {
    projectId: args.projectId,
    key: requested.id,
    name: requested.title ?? requested.id,
    userId: args.userId,
  });
  const conversation = {
    id: featureRow.slug,
    title: featureRow.name,
    ...(requested.iconUrl ? { iconUrl: requested.iconUrl } : {}),
  };
  return { featureRow, conversation };
}

type NewMessage = typeof message.$inferInsert & { id: string; expiresAt: Date };

/**
 * `insert into message (...) select <values> where <condition>`: the row is written only
 * when `condition` holds at that moment, inside the statement.
 */
function conditionalInsert(db: Database, values: NewMessage, condition: SQL) {
  const columns = getTableColumns(message);
  const names: SQL[] = [];
  const params: SQL[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = values[key as keyof NewMessage];
    if (value === undefined) {
      continue;
    }
    names.push(sql`${sql.identifier(column.name)}`);
    params.push(sql`${column.mapToDriverValue(value)}`);
  }
  return db.run(
    sql`insert into ${message} (${sql.join(names, sql`, `)}) select ${sql.join(params, sql`, `)} where ${condition}`,
  );
}

/**
 * Inserts the message. With an attachment, the insert and the link run in one batch (one
 * transaction): the insert happens only if the upload is still attachable at that moment,
 * and the link matches only if the insert happened. A publish that loses the upload to
 * another publish (or to retention) writes nothing and fails.
 */
async function storeMessage(
  db: Database,
  values: NewMessage,
  attach: AttachTarget | undefined,
): Promise<PublishedRow> {
  if (!attach) {
    const [row] = await db.insert(message).values(values).returning();
    if (!row) {
      throw new Error("message insert returned no row");
    }
    return { message: row, attachment: null };
  }
  const [, linkedRows] = await db.batch([
    conditionalInsert(
      db,
      values,
      sql`exists (select 1 from ${attachment} where ${attachableWhere(attach)})`,
    ),
    linkAttachment(db, { ...attach, messageId: values.id, expiresAt: values.expiresAt }),
  ]);
  const [linked] = linkedRows;
  if (!linked) {
    throw badRequest(
      "This attachment is no longer available: it was attached to another message or expired. Upload the file again.",
    );
  }
  const [row] = await db.select().from(message).where(eq(message.id, values.id)).limit(1);
  if (!row) {
    throw new Error("message insert returned no row");
  }
  return { message: row, attachment: linked };
}

/** Parses a stored JSON column with a contract schema; a bad row throws (a 500). */
export function parseStored<T extends z.ZodType>(
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
export function toMessage(
  row: MessageRow,
  projectName: string,
  publisher: UserRow | null,
  file: Attachment | null,
): Message {
  const assembled = {
    id: row.id,
    projectId: row.projectId,
    project: projectName,
    title: row.title,
    body: row.body,
    priority: row.priority,
    tags: parseStored(StoredTags, row.tagsJson, "tags_json", row.id),
    clickUrl: row.clickUrl,
    actions: parseStored(StoredActions, row.actionsJson, "actions_json", row.id),
    attachment: file,
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

export function toPublishOutput({ message: row }: PublishedRow, projectName: string) {
  return {
    id: row.id,
    project: projectName,
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

/**
 * Hands newly read message ids to the post-read hook (dismiss pushes). The read state is
 * already saved, so a failing hook is logged instead of failing the request.
 */
export function announceRead(dispatch: Dispatch, userId: string, messageIds: string[]): void {
  if (messageIds.length === 0) {
    return;
  }
  try {
    dispatch.messagesRead(userId, messageIds);
  } catch (error) {
    console.error("dispatch.messagesRead failed", error);
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

/** Columns for a message with its project name, publisher and attachment. */
const messageColumns = { message, projectName: project.name, publisher: user, attachment };

/** One project's non-expired messages, newest first: `limit + 1` rows from before `cursor`. */
export async function listProjectMessages(
  db: Database,
  args: { projectId: string; cursor?: string; since?: string; limit: number; origin: string },
) {
  const cursor = parseCursor(MessageId, args.cursor);
  const rows = await db
    .select(messageColumns)
    .from(message)
    .innerJoin(project, eq(project.id, message.projectId))
    .leftJoin(user, eq(user.id, message.publishedBy))
    .leftJoin(attachment, eq(attachment.messageId, message.id))
    .where(
      and(
        eq(message.projectId, args.projectId),
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
    (row) =>
      toMessage(
        row.message,
        row.projectName,
        row.publisher,
        attachmentOf(row.attachment, args.origin),
      ),
  );
}

/** A non-expired message with its project name and publisher, or `undefined`. */
export async function findMessage(db: Database, id: string) {
  const [row] = await db
    .select(messageColumns)
    .from(message)
    .innerJoin(project, eq(project.id, message.projectId))
    .leftJoin(user, eq(user.id, message.publishedBy))
    .leftJoin(attachment, eq(attachment.messageId, message.id))
    .where(and(eq(message.id, id), notExpired()))
    .limit(1);
  return row;
}

/**
 * Messages in the user's inbox (projects they are a member of), newest first, with
 * their read state. `extra` narrows it further, e.g. to one project or one id.
 */
export function selectInbox(db: Database, userId: string, extra: (SQL | undefined)[]) {
  return db
    .select({ ...messageColumns, readAt: messageRead.readAt })
    .from(message)
    .innerJoin(project, eq(project.id, message.projectId))
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, message.projectId), eq(projectMember.userId, userId)),
    )
    .leftJoin(user, eq(user.id, message.publishedBy))
    .leftJoin(attachment, eq(attachment.messageId, message.id))
    .leftJoin(
      messageRead,
      and(eq(messageRead.messageId, message.id), eq(messageRead.userId, userId)),
    )
    .where(and(notExpired(), ...extra))
    .orderBy(desc(message.id));
}

type InboxRow = {
  message: MessageRow;
  projectName: string;
  publisher: UserRow | null;
  attachment: AttachmentRow | null;
  readAt: Date | null;
};

/**
 * `userId`'s own responses to each of `messageIds`, oldest first, in one query. Messages
 * without one are absent from the map.
 */
export async function selectMyResponses(
  db: Database,
  userId: string,
  messageIds: string[],
): Promise<Map<string, MyResponse[]>> {
  const byMessage = new Map<string, MyResponse[]>();
  if (messageIds.length === 0) {
    return byMessage;
  }
  const rows = await db
    .select({
      messageId: messageResponse.messageId,
      actionKey: messageResponse.actionKey,
      kind: messageResponse.kind,
      text: messageResponse.text,
      createdAt: messageResponse.createdAt,
    })
    .from(messageResponse)
    .where(
      and(
        eq(messageResponse.userId, userId),
        // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
        sql`${messageResponse.messageId} in (select value from json_each(${JSON.stringify(messageIds)}))`,
      ),
    )
    .orderBy(asc(messageResponse.createdAt), asc(messageResponse.id));
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({
      actionKey: row.actionKey,
      kind: row.kind,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

/** Inbox rows as `InboxMessage`s, with the caller's own responses loaded in one query. */
export async function toInboxMessages(
  db: Database,
  userId: string,
  rows: InboxRow[],
  origin: string,
): Promise<InboxMessage[]> {
  const responses = await selectMyResponses(
    db,
    userId,
    rows.map((row) => row.message.id),
  );
  return rows.map((row) => ({
    ...toMessage(row.message, row.projectName, row.publisher, attachmentOf(row.attachment, origin)),
    read: row.readAt !== null,
    myResponses: responses.get(row.message.id) ?? [],
  }));
}

export const unreadOnly = () => isNull(messageRead.messageId);
