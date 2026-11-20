import { z } from "zod";

import { Conversation, Sender } from "./avatar";
import { idSchema, PageInput, Timestamp, UserSummary } from "./common";
import { ConversationRef } from "./conversation";
import { Priority } from "./priority";
import { ProjectId, ProjectName } from "./project";

export const MessageId = idSchema("message");
export const AttachmentId = idSchema("attachment");

export const MESSAGE_LIMITS = {
  titleLength: 250,
  urlLength: 2048,
  bodyLength: 4096,
  tags: 5,
  tagLength: 32,
  actions: 5,
  /** Android shows at most this many buttons on a notification. */
  notificationActions: 3,
  actionLabelLength: 40,
  httpBodyLength: 1024,
  quickReplies: 3,
  quickReplyLength: 40,
} as const;

/** Proposed cap, still open. See the Attachments page in the docs. */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Links a subscriber may open from a message: web pages and notifier's own deep
 * links. Anything else (`javascript:`, `intent:`, `file:` …) is rejected at publish.
 */
export const OpenableUrl = z
  .url({ protocol: /^(?:https?|notifier)$/u })
  .max(MESSAGE_LIMITS.urlLength);

export const Tag = z
  .string()
  .min(1)
  .max(MESSAGE_LIMITS.tagLength)
  .regex(/^[\p{L}\p{N}_:-]+$/u, "Tags are single words");

const ActionKey = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[a-z0-9_-]+$/u);

const ActionBase = z.object({
  /** Stable key so replies can say which button was used. Defaults to the index. */
  key: ActionKey.optional(),
  label: z.string().min(1).max(MESSAGE_LIMITS.actionLabelLength),
  /** Dismiss the notification after the action runs. */
  clear: z.boolean().default(false),
});

/** Opens a URL in the browser or a deep link in another app. */
export const ViewAction = ActionBase.extend({
  type: z.literal("view"),
  url: OpenableUrl,
});

/**
 * Sends an HTTP request from the subscriber's phone. No custom headers: anything
 * put here is readable by every subscriber.
 */
export const HttpAction = ActionBase.extend({
  type: z.literal("http"),
  url: z.url({ protocol: /^https$/u }).max(MESSAGE_LIMITS.urlLength),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("POST"),
  body: z.string().max(MESSAGE_LIMITS.httpBodyLength).optional(),
});

/**
 * Sends a response back to notifier. With `input: false` it is a one-tap
 * acknowledgement; with `input: true` Android shows an inline text reply.
 */
export const ReplyAction = ActionBase.extend({
  type: z.literal("reply"),
  input: z.boolean().default(false),
  placeholder: z.string().max(MESSAGE_LIMITS.actionLabelLength).optional(),
  quickReplies: z
    .array(z.string().min(1).max(MESSAGE_LIMITS.quickReplyLength))
    .max(MESSAGE_LIMITS.quickReplies)
    .optional(),
});

export const Action = z.discriminatedUnion("type", [ViewAction, HttpAction, ReplyAction]);
export type Action = z.infer<typeof Action>;
export type ActionInput = z.input<typeof Action>;

export const Attachment = z.object({
  id: AttachmentId,
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  size: z.number().int().min(0).max(ATTACHMENT_MAX_BYTES),
  /** Short-lived signed download URL. */
  url: z.url(),
  expiresAt: Timestamp,
});
export type Attachment = z.infer<typeof Attachment>;

export const PublishInput = z.object({
  project: ProjectName,
  title: z.string().min(1).max(MESSAGE_LIMITS.titleLength).optional(),
  body: z.string().max(MESSAGE_LIMITS.bodyLength).default(""),
  /** Falls back to the project's `defaultPriority`. */
  priority: Priority.optional(),
  tags: z.array(Tag).max(MESSAGE_LIMITS.tags).default([]),
  /** Opened when the notification is tapped. */
  clickUrl: OpenableUrl.optional(),
  actions: z.array(Action).max(MESSAGE_LIMITS.actions).default([]),
  /** From a previous attachment upload to the same project. */
  attachmentId: AttachmentId.optional(),
  /** What the message is about, e.g. a project. Groups notifications as a conversation. */
  conversation: Conversation.optional(),
  /** Who sent it within the conversation, e.g. an agent. Shown as the avatar badge. */
  sender: Sender.optional(),
});
export type PublishInput = z.input<typeof PublishInput>;

export const PublishOutput = z.object({
  id: MessageId,
  project: ProjectName,
  createdAt: Timestamp,
  expiresAt: Timestamp,
});

export const Message = z.object({
  id: MessageId,
  projectId: ProjectId,
  project: ProjectName,
  title: z.string().nullable(),
  body: z.string(),
  priority: Priority,
  tags: z.array(Tag),
  clickUrl: z.url().nullable(),
  actions: z.array(Action.and(z.object({ key: ActionKey }))),
  attachment: Attachment.nullable(),
  conversation: Conversation.nullable(),
  sender: Sender.nullable(),
  /** `null` when published with an access token that is no longer attributable. */
  publishedBy: UserSummary.nullable(),
  createdAt: Timestamp,
  expiresAt: Timestamp,
});
export type Message = z.infer<typeof Message>;

/**
 * One of the signed-in user's own responses to a message, so the app can show what they
 * already answered. Same fields as `MessageResponse`, without the ids and the user.
 */
export const MyResponse = z.object({
  actionKey: z.string(),
  kind: z.enum(["ack", "text"]),
  text: z.string().nullable(),
  createdAt: Timestamp,
});
export type MyResponse = z.infer<typeof MyResponse>;

/** A message in the signed-in user's inbox. */
export const InboxMessage = Message.extend({
  read: z.boolean(),
  /** The caller's own responses to this message, oldest first; never anyone else's. */
  myResponses: z.array(MyResponse),
});
export type InboxMessage = z.infer<typeof InboxMessage>;

export const ListMessagesInput = PageInput.extend({
  projectId: ProjectId.optional(),
  unreadOnly: z.boolean().default(false),
  /** Only this conversation's messages. Still newest first; the app reverses a thread. */
  conversation: ConversationRef.optional(),
});

export const MarkReadInput = z.union([
  z.object({ ids: z.array(MessageId).min(1).max(100) }),
  /** Marks everything up to and including this message, optionally within one project. */
  z.object({ upTo: MessageId, projectId: ProjectId.optional() }),
  /** Marks every message of one conversation. */
  z.object({ conversation: ConversationRef }),
]);

export const UploadAttachmentOutput = z.object({
  id: AttachmentId,
  /** Unreferenced uploads are deleted after this time. */
  expiresAt: Timestamp,
});
