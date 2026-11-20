import type { ConversationSummary } from "@notifier/contract/conversation";

import type { IconName } from "@/components/icon";

export type ChatAvatarSubject =
  /** A conversation: its icon, else initials on the contract's generated color. */
  | { kind: "conversation"; id: string; name: string; iconUrl: string | null }
  /** A project feed or any other non-chat row: a glyph on a quiet surface. */
  | { kind: "glyph"; name: string; glyph: IconName };

/** Name patterns and their glyphs, first match wins; most projects are deploys, backups or monitors. */
const PROJECT_GLYPHS: [RegExp, IconName][] = [
  [/deploy|release|ci\b|-ci|build/u, "rocket-launch"],
  [/backup|snapshot/u, "cloud-done"],
  [/uptime|monitor|health|ping/u, "monitor-heart"],
  [/server|host|lab|infra/u, "dns"],
];

/** Glyph for a project row, guessed from its name. */
export function projectGlyph(name: string): IconName {
  const lower = name.toLowerCase();
  return PROJECT_GLYPHS.find(([pattern]) => pattern.test(lower))?.[1] ?? "folder";
}

/** The avatar for a conversation summary: the conversation for chats, a glyph for project threads. */
export function conversationAvatar(conversation: ConversationSummary): ChatAvatarSubject {
  if (conversation.kind === "project" && !conversation.iconUrl) {
    return { kind: "glyph", name: conversation.title, glyph: projectGlyph(conversation.project) };
  }
  return {
    kind: "conversation",
    // Seeded like the message avatars and the web dashboard: the conversation id, or the
    // project name for a project feed.
    id: conversation.kind === "project" ? conversation.project : conversation.key.slice(2),
    name: conversation.title,
    iconUrl: conversation.iconUrl,
  };
}
