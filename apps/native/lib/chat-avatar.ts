import type { ConversationSummary } from "@notifier/contract/conversation";

import type { IconName } from "@/components/icon";

export type ChatAvatarSubject =
  /** A conversation: its icon, else initials on the contract's generated color. */
  | { kind: "conversation"; id: string; name: string; iconUrl: string | null }
  /** A topic feed or any other non-chat row: a glyph on a quiet surface. */
  | { kind: "glyph"; name: string; glyph: IconName };

/** Name patterns and their glyphs, first match wins; most topics are deploys, backups or monitors. */
const TOPIC_GLYPHS: [RegExp, IconName][] = [
  [/deploy|release|ci\b|-ci|build/u, "rocket-launch"],
  [/backup|snapshot/u, "cloud-done"],
  [/uptime|monitor|health|ping/u, "monitor-heart"],
  [/server|host|lab|infra/u, "dns"],
];

/** Glyph for a topic row, guessed from its name. */
export function topicGlyph(name: string): IconName {
  const lower = name.toLowerCase();
  return TOPIC_GLYPHS.find(([pattern]) => pattern.test(lower))?.[1] ?? "tag";
}

/** The avatar for a conversation summary: the project for chats, a glyph for topic feeds. */
export function conversationAvatar(conversation: ConversationSummary): ChatAvatarSubject {
  if (conversation.kind === "topic" && !conversation.iconUrl) {
    return { kind: "glyph", name: conversation.title, glyph: topicGlyph(conversation.topic) };
  }
  return {
    kind: "conversation",
    // Seeded like the message avatars and the web dashboard: the conversation id, or the
    // topic name for a topic feed.
    id: conversation.kind === "topic" ? conversation.topic : conversation.key.slice(2),
    name: conversation.title,
    iconUrl: conversation.iconUrl,
  };
}
