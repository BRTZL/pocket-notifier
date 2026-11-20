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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole local calendar days between `date` and `now` (0 today, 1 yesterday). */
function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY);
}

/** Local 24-hour `HH:mm`. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `Nov 14`, with the year when it is not this year. */
function shortDay(date: Date, now: Date): string {
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** Chat list time: `14:02` today, `Thu` within the week, else `Nov 14`. */
export function chatTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (days <= 0) {
    return clockTime(iso);
  }
  if (days < 7) {
    return WEEKDAYS[date.getDay()] ?? shortDay(date, now);
  }
  return shortDay(date, now);
}

/** Day separator in a thread: `Today`, `Yesterday`, else `Nov 14`. */
export function dayLabel(iso: string, now = new Date()): string {
  const days = daysAgo(new Date(iso), now);
  if (days <= 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return shortDay(new Date(iso), now);
}

/** Local calendar day key, to group thread items by day. */
export function dayKey(iso: string): number {
  return startOfDay(new Date(iso));
}
