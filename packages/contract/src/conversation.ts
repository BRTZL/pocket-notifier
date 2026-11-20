import { z } from "zod";

import { idSchema, PageInput, Timestamp } from "./common";
import { Priority } from "./priority";
import { ProjectId, ProjectName } from "./project";

/**
 * Conversations group a project's messages for the chat-style inbox. Each is scoped to
 * one project: the same conversation id in two projects is two conversations.
 *
 * - `c:<conversation.id>`: messages published with that `conversation`.
 * - `p:<project id>`: the project's messages without a conversation.
 */
export const ConversationKey = z
  .string()
  .regex(/^(?:c:.{1,64}|p:prj_[0-9a-z]{26})$/u, "Expected a conversation key");

export const ConversationRef = z
  .object({ projectId: ProjectId, key: ConversationKey })
  .refine((ref) => !ref.key.startsWith("p:") || ref.key === `p:${ref.projectId}`, {
    message: "A project conversation key must name its own project",
    path: ["key"],
  });
export type ConversationRef = z.infer<typeof ConversationRef>;

/** Longest `lastMessage.body` preview, in UTF-16 code units. */
export const CONVERSATION_PREVIEW_LENGTH = 140;

/**
 * The question the caller can still answer in writing: the newest non-expired message
 * of the conversation with a `reply` action that takes text (`input: true`) and that
 * the caller has not answered yet. The app's composer answers it.
 */
export const OpenAsk = z.object({
  messageId: idSchema("message"),
  /** The first unanswered text reply action of that message. */
  actionKey: z.string(),
  /** `sender.name`, else `sender.id`; `null` without a sender. */
  senderName: z.string().nullable(),
  title: z.string().nullable(),
});
export type OpenAsk = z.infer<typeof OpenAsk>;

/** A row of the conversation inbox, described by its latest non-expired message. */
export const ConversationSummary = z.object({
  projectId: ProjectId,
  project: ProjectName,
  /**
   * The project's display name, else its name: what to show for the project. The
   * personal project's generated name (`general-…`) is never shown; it reads "General".
   */
  projectTitle: z.string().min(1),
  key: ConversationKey,
  /** `conversation.title`, else `conversation.id`, else the project's display name or name. */
  title: z.string().min(1),
  iconUrl: z.url().nullable(),
  kind: z.enum(["conversation", "project"]),
  lastMessage: z.object({
    id: idSchema("message"),
    title: z.string().nullable(),
    /** The body on one line, cut to `CONVERSATION_PREVIEW_LENGTH`. */
    body: z.string().max(CONVERSATION_PREVIEW_LENGTH),
    /** `sender.name`, else `sender.id`; `null` without a sender. */
    senderName: z.string().nullable(),
    priority: Priority,
    createdAt: Timestamp,
  }),
  unreadCount: z.number().int().min(0),
  /** The caller's subscription to the project is muted. */
  muted: z.boolean(),
  openAsk: OpenAsk.nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

/** `cursor` is the `lastMessage.id` of the previous page's last item. */
export const ListConversationsInput = PageInput;

export const GetConversationInput = z.object({ conversation: ConversationRef });
