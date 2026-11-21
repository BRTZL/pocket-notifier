import { z } from "zod";

/**
 * Who a message is from and what it is about, for chat-style notifications.
 *
 * - `conversation` is the thing the message belongs to, e.g. a project. It is the
 *   large avatar and the conversation title on Android; messages with the same
 *   conversation id stack together.
 * - `sender` is who sent it inside that conversation, e.g. an agent. It is the
 *   small badge on the avatar.
 *
 * Without an `iconUrl`, apps draw a generated avatar: initials on a color picked
 * from the id. `avatarInitials` and `avatarColor` keep web and phone identical.
 */
const AvatarKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}._:@/-]+$/u, "Use letters, digits and . _ : @ / -");

/** An HTTPS image URL: a project icon, or a per-message conversation or sender icon. */
export const IconUrl = z.url({ protocol: /^https$/u }).max(2048);

export const Conversation = z.object({
  /** Stable key, e.g. the project name. Same id, same avatar and stack. */
  id: AvatarKey,
  /** Shown as the conversation title. Defaults to `id`. */
  title: z.string().min(1).max(64).optional(),
  iconUrl: IconUrl.optional(),
});
export type Conversation = z.infer<typeof Conversation>;

export const Sender = z.object({
  /** Stable key, e.g. `claude` or `codex`. */
  id: AvatarKey,
  /** Shown next to the conversation title. Defaults to `id`. */
  name: z.string().min(1).max(40).optional(),
  iconUrl: IconUrl.optional(),
});
export type Sender = z.infer<typeof Sender>;

/** Background colors for generated avatars; text is always white. */
export const AVATAR_PALETTE = [
  "#E5484D",
  "#F76B15",
  "#FFB224",
  "#30A46C",
  "#12A594",
  "#0090FF",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#6F6E77",
] as const;

const WORD_SEPARATORS = /[\s._:@/-]+/u;

/** Up to two letters: first letters of the first two words, or the first two characters. */
export function avatarInitials(name: string) {
  const words = name
    .split(WORD_SEPARATORS)
    .map((word) => word.trim())
    .filter(Boolean);
  const [first = "", second] = words;
  const letters = second === undefined ? [...first].slice(0, 2) : [[...first][0], [...second][0]];
  return letters.join("").toUpperCase() || "?";
}

/** FNV-1a hash of the id, so the same id always gets the same color. */
export function avatarColor(id: string) {
  let hash = 0x81_1c_9d_c5;
  for (const char of id) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is defined with XOR.
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: converts the hash to an unsigned 32-bit integer.
  const index = (hash >>> 0) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index] ?? AVATAR_PALETTE[0];
}
