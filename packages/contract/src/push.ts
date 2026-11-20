import { z } from "zod";

import { ConversationKey } from "./conversation";
import { MessageId } from "./message";
import type { Priority } from "./priority";
import { ProjectId, ProjectName } from "./project";

/**
 * Wire format of the FCM data-only message the server sends to devices.
 *
 * FCM data values must be strings and the whole message must stay under 4096
 * bytes, so long fields are cut and `truncated` is set. The app then fetches the
 * full message with `messages.get` before showing actions or attachments.
 */
/**
 * Bumped whenever a field is renamed or its meaning changes, so an older app drops a
 * payload it cannot read instead of misreading it. `"2"`: the message is named by
 * `project` / `projectId` / `conversationKey` (`p:<project id>` for the project-level
 * thread) instead of the earlier fields.
 */
export const PUSH_VERSION = "2";
export const FCM_MAX_PAYLOAD_BYTES = 4096;
export const PUSH_BODY_MAX = 1000;

const StringFlag = z.enum(["0", "1"]);
const EpochMillis = z.string().regex(/^\d{13}$/u);

export const PushMessageData = z.object({
  v: z.literal(PUSH_VERSION),
  kind: z.literal("message"),
  id: MessageId,
  project: ProjectName,
  /** With `conversationKey`, names the thread a tap opens: `notifier://conversation/<projectId>/<key>`. */
  projectId: ProjectId,
  /** `c:<feature slug>`, or `p:<project id>` for the project-level thread (no feature). */
  conversationKey: ConversationKey,
  title: z.string(),
  body: z.string().max(PUSH_BODY_MAX),
  priority: z.enum(["1", "2", "3", "4", "5"]),
  /** Comma-separated tags. */
  tags: z.string(),
  clickUrl: z.string(),
  /** JSON-encoded `Message["actions"]`, or `""` when left out to save space. */
  actions: z.string(),
  /** Attachment file name, or `""`. */
  attachment: z.string(),
  /** Conversation id, title and icon URL; `""` when the message has none. */
  conversationId: z.string(),
  conversationTitle: z.string(),
  conversationIcon: z.string(),
  /** Sender id, name and icon URL; `""` when the message has none. */
  senderId: z.string(),
  senderName: z.string(),
  senderIcon: z.string(),
  truncated: StringFlag,
  createdAt: EpochMillis,
});

/** Tells other devices to remove notifications for messages read elsewhere. */
export const PushDismissData = z.object({
  v: z.literal(PUSH_VERSION),
  kind: z.literal("dismiss"),
  /** Comma-separated message ids. */
  ids: z.string(),
});

export const PushData = z.discriminatedUnion("kind", [PushMessageData, PushDismissData]);
export type PushData = z.infer<typeof PushData>;

/** Names follow `AndroidImportance` in expo-notifications. */
export type AndroidImportance = "MIN" | "LOW" | "DEFAULT" | "HIGH" | "MAX";

export type AndroidChannel = {
  id: string;
  name: string;
  description: string;
  importance: AndroidImportance;
  sound: boolean;
  vibrate: boolean;
  /** Ask to bypass Do Not Disturb; the user must still allow it in system settings. */
  bypassDnd: boolean;
};

/**
 * One Android notification channel per priority. Channel IDs are permanent:
 * Android keeps user settings per ID, so changing behaviour needs a new ID.
 */
export const ANDROID_CHANNELS = {
  1: {
    id: "priority-1",
    name: "Min priority",
    description: "No sound, no status bar icon",
    importance: "MIN",
    sound: false,
    vibrate: false,
    bypassDnd: false,
  },
  2: {
    id: "priority-2",
    name: "Low priority",
    description: "Shown silently",
    importance: "LOW",
    sound: false,
    vibrate: false,
    bypassDnd: false,
  },
  3: {
    id: "priority-3",
    name: "Default priority",
    description: "Sound and vibration",
    importance: "DEFAULT",
    sound: true,
    vibrate: true,
    bypassDnd: false,
  },
  4: {
    id: "priority-4",
    name: "High priority",
    description: "Pops up on screen",
    importance: "HIGH",
    sound: true,
    vibrate: true,
    bypassDnd: false,
  },
  5: {
    id: "priority-5",
    name: "Urgent",
    description: "Pops up on screen, long vibration, can bypass Do Not Disturb",
    importance: "MAX",
    sound: true,
    vibrate: true,
    bypassDnd: true,
  },
} as const satisfies Record<Priority, AndroidChannel>;

/**
 * Notifications stack under this key: per conversation when the message has
 * one, otherwise per project.
 */
export function notificationGroupKey(project: string, conversationId?: string) {
  return conversationId
    ? `project:${project}:conversation:${conversationId}`
    : `project:${project}`;
}
