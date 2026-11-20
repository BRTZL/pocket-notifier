import { z } from "zod";

import { idSchema, Timestamp, UserSummary } from "./common";
import { Priority } from "./priority";

export const TopicId = idSchema("topic");

/**
 * Topic names are unique per deployment and appear in publish URLs:
 * lowercase letters, digits, `-` and `_`, starting with a letter or digit.
 */
export const TopicName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u, "Use lowercase letters, digits, '-' or '_'");

export const RETENTION_DAYS = { default: 30, min: 1, max: 365 } as const;

export const RetentionDays = z
  .number()
  .int()
  .min(RETENTION_DAYS.min)
  .max(RETENTION_DAYS.max)
  .default(RETENTION_DAYS.default);

/**
 * - `owner`: manages the topic and its members, publishes, subscribes.
 * - `publisher`: publishes and reads history.
 * - `subscriber`: reads history and receives pushes.
 */
export const TopicRole = z.enum(["owner", "publisher", "subscriber"]);
export type TopicRole = z.infer<typeof TopicRole>;

export const Topic = z.object({
  id: TopicId,
  name: TopicName,
  displayName: z.string().min(1).max(80).nullable(),
  description: z.string().max(500).nullable(),
  defaultPriority: Priority,
  retentionDays: RetentionDays,
  createdAt: Timestamp,
});
export type Topic = z.infer<typeof Topic>;

/** A topic as seen by the signed-in user. */
export const MyTopic = Topic.extend({
  role: TopicRole,
  /** Whether this user's devices receive pushes for the topic. */
  subscribed: z.boolean(),
  /** Subscribed but silenced: messages land in the inbox without a push. */
  muted: z.boolean(),
  unreadCount: z.number().int().min(0),
  lastMessageAt: Timestamp.nullable(),
});
export type MyTopic = z.infer<typeof MyTopic>;

export const CreateTopicInput = z.object({
  name: TopicName,
  displayName: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  defaultPriority: Priority.optional(),
  retentionDays: RetentionDays.optional(),
});

export const UpdateTopicInput = z.object({
  id: TopicId,
  displayName: z.string().min(1).max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  defaultPriority: Priority.optional(),
  retentionDays: RetentionDays.optional(),
});

export const TopicMember = z.object({
  topicId: TopicId,
  user: UserSummary,
  role: TopicRole,
  addedAt: Timestamp,
});
export type TopicMember = z.infer<typeof TopicMember>;

export const AddMemberInput = z.object({
  topicId: TopicId,
  /** Email of an existing user. New people join through an invite first. */
  email: z.email(),
  role: TopicRole.exclude(["owner"]),
});

export const UpdateMemberInput = z.object({
  topicId: TopicId,
  userId: z.string().min(1),
  role: TopicRole,
});

export const SubscriptionInput = z.object({
  topicId: TopicId,
  subscribed: z.boolean(),
  muted: z.boolean().default(false),
});
