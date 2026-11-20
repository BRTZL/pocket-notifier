import type { InboxMessage } from "@notifier/contract/message";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time for list rows: `now`, `3m`, `2h`, `5d`, then a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) {
    return "now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }
  if (elapsed < 7 * DAY) {
    return `${Math.floor(elapsed / DAY)}d`;
  }
  return new Date(time).toLocaleDateString();
}

/** Full local date and time for the detail screen. */
export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

type Headline = Pick<InboxMessage, "conversation" | "sender" | "topic">;

/**
 * The row's title line: `<conversation> · <sender>` for chat-style messages,
 * otherwise the topic name.
 */
export function messageHeadline({ conversation, sender, topic }: Headline): string {
  if (!conversation) {
    return sender ? `${topic} · ${sender.name ?? sender.id}` : topic;
  }
  const title = conversation.title ?? conversation.id;
  return sender ? `${title} · ${sender.name ?? sender.id}` : title;
}

/** Whether a priority deserves a marker (high and urgent). */
export function isHighPriority(priority: number): boolean {
  return priority >= 4;
}

/** Local date without the time, for expiry and "last used" lines. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
