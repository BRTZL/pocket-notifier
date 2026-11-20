import { DEFAULT_PRIORITY } from "@notifier/contract/priority";
import { RETENTION_DAYS } from "@notifier/contract/topic";
import { defineRelationsPart, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

function createdAt() {
  return integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull();
}

export const topic = sqliteTable("topic", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  description: text("description"),
  defaultPriority: integer("default_priority").default(DEFAULT_PRIORITY).notNull(),
  retentionDays: integer("retention_days").default(RETENTION_DAYS.default).notNull(),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowMs)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const topicMember = sqliteTable(
  "topic_member",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "publisher", "subscriber"] }).notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.userId] }),
    index("topic_member_userId_idx").on(table.userId),
    check("topic_member_role_check", sql`${table.role} in ('owner', 'publisher', 'subscriber')`),
  ],
);

export const subscription = sqliteTable(
  "subscription",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    muted: integer("muted", { mode: "boolean" }).default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.userId] }),
    index("subscription_userId_idx").on(table.userId),
  ],
);

export const accessToken = sqliteTable(
  "access_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 hex of the secret. The secret itself is never stored. */
    hash: text("hash").notNull().unique(),
    /** First characters of the secret, shown in token lists. */
    start: text("start").notNull(),
    scopeJson: text("scope_json").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("access_token_userId_idx").on(table.userId),
    check(
      "access_token_hash_check",
      sql`length(${table.hash}) = 64 and ${table.hash} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    title: text("title"),
    body: text("body").default("").notNull(),
    priority: integer("priority").notNull(),
    tagsJson: text("tags_json").notNull(),
    clickUrl: text("click_url"),
    actionsJson: text("actions_json").notNull(),
    conversationJson: text("conversation_json"),
    senderJson: text("sender_json"),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    tokenId: text("token_id").references(() => accessToken.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("message_topicId_id_idx").on(table.topicId, table.id),
    index("message_expiresAt_idx").on(table.expiresAt),
    check("message_priority_check", sql`${table.priority} in (1, 2, 3, 4, 5)`),
  ],
);

export const messageRead = sqliteTable(
  "message_read",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

export const messageResponse = sqliteTable(
  "message_response",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actionKey: text("action_key").notNull(),
    kind: text("kind", { enum: ["ack", "text"] }).notNull(),
    text: text("text"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("message_response_messageId_userId_actionKey_uidx").on(
      table.messageId,
      table.userId,
      table.actionKey,
    ),
    check("message_response_kind_check", sql`${table.kind} in ('ack', 'text')`),
  ],
);

export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pushToken: text("push_token").notNull().unique(),
    name: text("name").notNull(),
    platform: text("platform", { enum: ["android", "ios"] }).notNull(),
    appVersion: text("app_version"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("device_userId_idx").on(table.userId),
    check("device_platform_check", sql`${table.platform} in ('android', 'ios')`),
  ],
);

export const invite = sqliteTable(
  "invite",
  {
    id: text("id").primaryKey(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    email: text("email"),
    grantsJson: text("grants_json").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [index("invite_createdBy_idx").on(table.createdBy)],
);

export const notifierRelations = defineRelationsPart(
  {
    user,
    topic,
    topicMember,
    subscription,
    accessToken,
    message,
    messageRead,
    messageResponse,
    device,
    invite,
  },
  (r) => ({
    user: {
      memberships: r.many.topicMember({ from: r.user.id, to: r.topicMember.userId }),
      subscriptions: r.many.subscription({ from: r.user.id, to: r.subscription.userId }),
      accessTokens: r.many.accessToken({ from: r.user.id, to: r.accessToken.userId }),
      devices: r.many.device({ from: r.user.id, to: r.device.userId }),
      invites: r.many.invite({ from: r.user.id, to: r.invite.createdBy }),
    },
    topic: {
      members: r.many.topicMember({ from: r.topic.id, to: r.topicMember.topicId }),
      subscriptions: r.many.subscription({ from: r.topic.id, to: r.subscription.topicId }),
      messages: r.many.message({ from: r.topic.id, to: r.message.topicId }),
    },
    topicMember: {
      topic: r.one.topic({ from: r.topicMember.topicId, to: r.topic.id, optional: false }),
      user: r.one.user({ from: r.topicMember.userId, to: r.user.id, optional: false }),
    },
    subscription: {
      topic: r.one.topic({ from: r.subscription.topicId, to: r.topic.id, optional: false }),
      user: r.one.user({ from: r.subscription.userId, to: r.user.id, optional: false }),
    },
    accessToken: {
      user: r.one.user({ from: r.accessToken.userId, to: r.user.id, optional: false }),
    },
    message: {
      topic: r.one.topic({ from: r.message.topicId, to: r.topic.id, optional: false }),
      publisher: r.one.user({ from: r.message.publishedBy, to: r.user.id }),
      token: r.one.accessToken({ from: r.message.tokenId, to: r.accessToken.id }),
      responses: r.many.messageResponse({ from: r.message.id, to: r.messageResponse.messageId }),
      reads: r.many.messageRead({ from: r.message.id, to: r.messageRead.messageId }),
    },
    messageRead: {
      message: r.one.message({ from: r.messageRead.messageId, to: r.message.id, optional: false }),
      user: r.one.user({ from: r.messageRead.userId, to: r.user.id, optional: false }),
    },
    messageResponse: {
      message: r.one.message({
        from: r.messageResponse.messageId,
        to: r.message.id,
        optional: false,
      }),
      user: r.one.user({ from: r.messageResponse.userId, to: r.user.id, optional: false }),
    },
    device: {
      user: r.one.user({ from: r.device.userId, to: r.user.id, optional: false }),
    },
    invite: {
      creator: r.one.user({ from: r.invite.createdBy, to: r.user.id, optional: false }),
      acceptor: r.one.user({ from: r.invite.acceptedBy, to: r.user.id }),
    },
  }),
);
