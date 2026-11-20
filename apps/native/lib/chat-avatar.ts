import type { ConversationSummary } from "@notifier/contract/conversation";

import type { IconName } from "@/components/icon";

export type ChatAvatarSubject =
  /** A conversation: its icon, else initials on the contract's generated color. */
  | { kind: "conversation"; id: string; name: string; iconUrl: string | null }
  /** A topic feed or any other non-chat row: a glyph on a quiet surface. */
  | { kind: "glyph"; name: string; glyph: IconName };

/** Glyph for a topic row, guessed from its name; most topics are deploys, backups or monitors. */
export function topicGlyph(name: string): IconName {
  const lower = name.toLowerCase();
  if (/deploy|release|ci\b|-ci|build/u.test(lower)) {
    return "rocket-launch";
  }
  if (/backup|snapshot/u.test(lower)) {
    return "cloud-done";
  }
  if (/uptime|monitor|health|ping/u.test(lower)) {
    return "monitor-heart";
  }
  if (/server|host|lab|infra/u.test(lower)) {
    return "dns";
  }
  return "tag";
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
