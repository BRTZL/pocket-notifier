import type { InboxMessage } from "@notifier/contract/message";

import { dayKey, dayLabel } from "@/lib/format";

type ReplyAction = Extract<InboxMessage["actions"][number], { type: "reply" }>;

export type ThreadItem =
  | { type: "day"; key: string; label: string }
  | {
      type: "message";
      key: string;
      message: InboxMessage;
      /** Sender name above the first bubble of a run from the same sender; `null` hides it. */
      senderLabel: string | null;
      /** Last bubble of a run: shows the time under it. */
      isRunEnd: boolean;
      /** Follows a bubble of the same run, so it sits closer to it. */
      continuesRun: boolean;
    }
  | {
      type: "mine";
      key: string;
      text: string;
      createdAt: string;
      continuesRun: boolean;
    };

type Event =
  | { kind: "message"; at: string; message: InboxMessage }
  | { kind: "mine"; at: string; key: string; text: string };

function senderKey(message: InboxMessage): string {
  return message.sender?.id ?? "";
}

function senderName(message: InboxMessage): string | null {
  return message.sender ? (message.sender.name ?? message.sender.id) : null;
}

/** What one of the user's responses says: their text, or the label of the button they tapped. */
function responseText(message: InboxMessage, actionKey: string, text: string | null): string {
  if (text) {
    return text;
  }
  const action = message.actions.find((candidate) => candidate.key === actionKey);
  return action?.label ?? "Answered";
}

/**
 * A conversation's loaded messages (newest first, as the API pages them) and the user's
 * own responses as one timeline, newest first for an inverted list: day separators,
 * agent bubbles grouped into runs per sender, and the user's replies.
 */
export function buildThread(newestFirst: InboxMessage[]): ThreadItem[] {
  const events: Event[] = [];
  for (const message of [...newestFirst].reverse()) {
    events.push({ kind: "message", at: message.createdAt, message });
    for (const response of message.myResponses) {
      events.push({
        kind: "mine",
        at: response.createdAt,
        key: `${message.id}:${response.actionKey}`,
        text: responseText(message, response.actionKey, response.text),
      });
    }
  }
  // Stable: a message stays before a response with the same timestamp.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const items: ThreadItem[] = [];
  let lastDay: number | null = null;
  events.forEach((event, index) => {
    const day = dayKey(event.at);
    const isNewDay = day !== lastDay;
    if (isNewDay) {
      items.push({ type: "day", key: `day:${day}`, label: dayLabel(event.at) });
      lastDay = day;
    }
    const previous = isNewDay ? undefined : events[index - 1];
    const next = events[index + 1];
    const nextSameDay = next !== undefined && dayKey(next.at) === day;

    if (event.kind === "mine") {
      items.push({
        type: "mine",
        key: `mine:${event.key}`,
        text: event.text,
        createdAt: event.at,
        continuesRun: previous?.kind === "mine",
      });
      return;
    }
    const sameSender = (other: Event | undefined) =>
      other?.kind === "message" && senderKey(other.message) === senderKey(event.message);
    const continuesRun = sameSender(previous);
    items.push({
      type: "message",
      key: event.message.id,
      message: event.message,
      senderLabel: continuesRun ? null : senderName(event.message),
      isRunEnd: !(nextSameDay && sameSender(next)),
      continuesRun,
    });
  });
  return items.reverse();
}

/** Whether the user still has to answer this reply action. */
export function isUnanswered(message: InboxMessage, action: ReplyAction): boolean {
  return !message.myResponses.some((response) => response.actionKey === action.key);
}

/** The reply actions of a message the user has not answered yet. */
export function openReplyActions(message: InboxMessage): ReplyAction[] {
  return message.actions.filter(
    (action): action is ReplyAction => action.type === "reply" && isUnanswered(message, action),
  );
}
