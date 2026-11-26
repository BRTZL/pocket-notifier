import { DEFAULT_PRIORITY } from "@notifier/contract/priority";
import { RETENTION_DAYS } from "@notifier/contract/project";
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

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    displayName: text("display_name"),
    description: text("description"),
    /**
     * The project's icon: an uploaded image (`/api/icons/<project id>/<file>` on this
     * deployment, stored in R2 under `icons/`) or any HTTPS URL an owner set.
     */
    iconUrl: text("icon_url"),
    defaultPriority: integer("default_priority").default(DEFAULT_PRIORITY).notNull(),
    retentionDays: integer("retention_days").default(RETENTION_DAYS.default).notNull(),
    /**
     * Set on a user's personal "General" project, which takes notifications sent without
     * a project. At most one per user (the unique index). Uniqueness is an index, not a
     * column constraint, so adding the column stays an `ALTER TABLE` instead of a table
     * rebuild (dropping `project` on D1 would cascade-delete its messages).
     */
    personalUserId: text("personal_user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("project_personalUserId_uidx").on(table.personalUserId)],
);

/**
 * A feature (workstream) inside a project, e.g. "improving performance" in "rezme". In
 * the app a feature is a conversation: messages sent to it carry
 * `conversation = { id: slug, title: name }`.
 */
export const feature = sqliteTable(
  "feature",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** Unique per project: lowercase `[a-z0-9][a-z0-9-]{0,62}`; the conversation id. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "done", "archived"] })
      .default("active")
      .notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    /**
     * The T3 Code thread this feature follows, when an agent in that thread sent to it.
     * Messages from the same thread always land here, whatever feature name they pass.
     */
    t3EnvironmentId: text("t3_environment_id"),
    t3ThreadId: text("t3_thread_id"),
  },
  (table) => [
    uniqueIndex("feature_projectId_slug_uidx").on(table.projectId, table.slug),
    uniqueIndex("feature_projectId_t3Thread_uidx")
      .on(table.projectId, table.t3EnvironmentId, table.t3ThreadId)
      .where(sql`${table.t3ThreadId} is not null`),
    check("feature_status_check", sql`${table.status} in ('active', 'done', 'archived')`),
    check(
      "feature_slug_check",
      sql`length(${table.slug}) between 1 and 63 and ${table.slug} not glob '*[^a-z0-9-]*' and substr(${table.slug}, 1, 1) <> '-'`,
    ),
  ],
);

export const projectMember = sqliteTable(
  "project_member",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "publisher", "subscriber"] }).notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_member_userId_idx").on(table.userId),
    check("project_member_role_check", sql`${table.role} in ('owner', 'publisher', 'subscriber')`),
  ],
);

export const subscription = sqliteTable(
  "subscription",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    muted: integer("muted", { mode: "boolean" }).default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
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
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title"),
    body: text("body").default("").notNull(),
    priority: integer("priority").notNull(),
    tagsJson: text("tags_json").notNull(),
    clickUrl: text("click_url"),
    actionsJson: text("actions_json").notNull(),
    conversationJson: text("conversation_json"),
    senderJson: text("sender_json"),
    /**
     * Which conversation of its project the message belongs to: `c:<conversation.id>`, or
     * `p:<project id>` for messages without a conversation. Set at publish. The `''`
     * default matches the column the migration added; the
     * `message_conversation_key_default` trigger replaces it with the derived key.
     */
    conversationKey: text("conversation_key").default("").notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    tokenId: text("token_id").references(() => accessToken.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("message_projectId_id_idx").on(table.projectId, table.id),
    index("message_projectId_conversationKey_id_idx").on(
      table.projectId,
      table.conversationKey,
      table.id,
    ),
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

/**
 * A file attached to (or uploaded for) a message, stored in R2 at `r2Key`. One per
 * message. Uploaded first, then linked by a publish with its `attachmentId`; uploads
 * never linked are deleted once `expiresAt` (upload time + `UNUSED_UPLOAD_TTL_MS`)
 * passes. Linking sets `expiresAt` to the message's, so the file goes with its message.
 */
export const attachment = sqliteTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /**
     * The message it is attached to; `null` until published. `set null` rather than
     * cascade: a row whose message went keeps its R2 key, so retention still deletes
     * the object instead of leaking it.
     */
    messageId: text("message_id").references(() => message.id, { onDelete: "set null" }),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    /** The access token of a REST upload; `null` for app and MCP upload-link uploads. */
    tokenId: text("token_id").references(() => accessToken.id, { onDelete: "set null" }),
    /** Sanitized file name, shown in the apps and sent in `Content-Disposition`. */
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    /** Bytes stored; the declared size until an upload link is used. */
    size: integer("size").notNull(),
    r2Key: text("r2_key").notNull(),
    /** Random, unguessable part of the download URL; compared in constant time. */
    downloadToken: text("download_token").notNull(),
    /** SHA-256 hex of an MCP upload link's one-time token; cleared when the link is used. */
    uploadTokenHash: text("upload_token_hash"),
    /** When the upload link stops working. */
    uploadExpiresAt: integer("upload_expires_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["pending", "uploaded"] })
      .default("pending")
      .notNull(),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("attachment_messageId_uidx").on(table.messageId),
    index("attachment_expiresAt_idx").on(table.expiresAt),
    index("attachment_projectId_idx").on(table.projectId),
    check("attachment_status_check", sql`${table.status} in ('pending', 'uploaded')`),
  ],
);

export const notifierRelations = defineRelationsPart(
  {
    user,
    project,
    feature,
    projectMember,
    subscription,
    accessToken,
    message,
    messageRead,
    messageResponse,
    device,
    invite,
    attachment,
  },
  (r) => ({
    user: {
      memberships: r.many.projectMember({ from: r.user.id, to: r.projectMember.userId }),
      subscriptions: r.many.subscription({ from: r.user.id, to: r.subscription.userId }),
      accessTokens: r.many.accessToken({ from: r.user.id, to: r.accessToken.userId }),
      devices: r.many.device({ from: r.user.id, to: r.device.userId }),
      invites: r.many.invite({ from: r.user.id, to: r.invite.createdBy }),
    },
    project: {
      members: r.many.projectMember({ from: r.project.id, to: r.projectMember.projectId }),
      subscriptions: r.many.subscription({ from: r.project.id, to: r.subscription.projectId }),
      messages: r.many.message({ from: r.project.id, to: r.message.projectId }),
      features: r.many.feature({ from: r.project.id, to: r.feature.projectId }),
    },
    feature: {
      project: r.one.project({ from: r.feature.projectId, to: r.project.id, optional: false }),
    },
    projectMember: {
      project: r.one.project({
        from: r.projectMember.projectId,
        to: r.project.id,
        optional: false,
      }),
      user: r.one.user({ from: r.projectMember.userId, to: r.user.id, optional: false }),
    },
    subscription: {
      project: r.one.project({ from: r.subscription.projectId, to: r.project.id, optional: false }),
      user: r.one.user({ from: r.subscription.userId, to: r.user.id, optional: false }),
    },
    accessToken: {
      user: r.one.user({ from: r.accessToken.userId, to: r.user.id, optional: false }),
    },
    message: {
      project: r.one.project({ from: r.message.projectId, to: r.project.id, optional: false }),
      publisher: r.one.user({ from: r.message.publishedBy, to: r.user.id }),
      token: r.one.accessToken({ from: r.message.tokenId, to: r.accessToken.id }),
      responses: r.many.messageResponse({ from: r.message.id, to: r.messageResponse.messageId }),
      reads: r.many.messageRead({ from: r.message.id, to: r.messageRead.messageId }),
      attachment: r.one.attachment({ from: r.message.id, to: r.attachment.messageId }),
    },
    attachment: {
      project: r.one.project({ from: r.attachment.projectId, to: r.project.id, optional: false }),
      message: r.one.message({ from: r.attachment.messageId, to: r.message.id }),
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
