import type { Message } from "@notifier/contract/message";
import {
  FCM_MAX_PAYLOAD_BYTES,
  PUSH_BODY_MAX,
  PUSH_VERSION,
  PushDismissData,
  PushMessageData,
} from "@notifier/contract/push";
import type { z } from "zod";

type MessageData = z.infer<typeof PushMessageData>;
type DismissData = z.infer<typeof PushDismissData>;
type OptionalKey = Exclude<
  keyof MessageData,
  "v" | "kind" | "id" | "topic" | "priority" | "createdAt" | "truncated"
>;

/** Optional fields after the always-sent ones, in the order `api/push-payload.mdx` fills them. */
const FILL_ORDER: readonly OptionalKey[] = [
  "title",
  "conversationId",
  "conversationTitle",
  "senderId",
  "senderName",
  "body",
  "actions",
  "tags",
  "clickUrl",
  "attachment",
  "conversationIcon",
  "senderIcon",
];

const encoder = new TextEncoder();

/** Size FCM counts: the JSON-encoded `data` object as UTF-8. */
export function pushDataBytes(data: Record<string, string>): number {
  return encoder.encode(JSON.stringify(data)).length;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The longest prefix of `text` that ends on a grapheme boundary, is at most `max`
 * UTF-16 code units (what `z.string().max` counts), and passes `fits`.
 */
function cutText(text: string, max: number, fits: (candidate: string) => boolean): string {
  const ends: number[] = [];
  for (const { index, segment } of graphemes.segment(text)) {
    const end = index + segment.length;
    if (end > max) {
      break;
    }
    ends.push(end);
  }
  // Binary search over grapheme ends for the longest prefix that fits.
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const end = ends[mid - 1] ?? 0;
    if (fits(text.slice(0, end))) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low === 0 ? 0 : (ends[low - 1] ?? 0));
}

function fullValues(message: Message): Record<OptionalKey, string> {
  return {
    title: message.title ?? "",
    body: message.body,
    tags: message.tags.join(","),
    clickUrl: message.clickUrl ?? "",
    actions: message.actions.length > 0 ? JSON.stringify(message.actions) : "",
    attachment: message.attachment?.name ?? "",
    conversationId: message.conversation?.id ?? "",
    conversationTitle: message.conversation?.title ?? "",
    conversationIcon: message.conversation?.iconUrl ?? "",
    senderId: message.sender?.id ?? "",
    senderName: message.sender?.name ?? "",
    senderIcon: message.sender?.iconUrl ?? "",
  };
}

/**
 * The FCM `data` for a `message` push, per `api/push-payload.mdx`: fields are added in
 * fill order until the next one would push the payload past 4,096 bytes; the body is
 * cut to `PUSH_BODY_MAX` (and, if needed, to the space left) on a grapheme boundary.
 * `truncated` is `"1"` when anything was cut or left out.
 */
export function toPushData(message: Message): MessageData {
  const data: MessageData = {
    v: PUSH_VERSION,
    kind: "message",
    id: message.id,
    topic: message.topic,
    title: "",
    body: "",
    priority: String(message.priority) as MessageData["priority"],
    tags: "",
    clickUrl: "",
    actions: "",
    attachment: "",
    conversationId: "",
    conversationTitle: "",
    conversationIcon: "",
    senderId: "",
    senderName: "",
    senderIcon: "",
    truncated: "0",
    createdAt: String(Date.parse(message.createdAt)),
  };
  const full = fullValues(message);
  const fits = (key: OptionalKey, value: string) =>
    pushDataBytes({ ...data, [key]: value }) <= FCM_MAX_PAYLOAD_BYTES;

  let cut = false;
  for (const key of FILL_ORDER) {
    const value = full[key];
    if (value === "") {
      continue;
    }
    if (key === "body") {
      const body = cutText(value, PUSH_BODY_MAX, (candidate) => fits("body", candidate));
      data.body = body;
      if (body.length < value.length) {
        cut = true;
        break;
      }
      continue;
    }
    if (!fits(key, value)) {
      cut = true;
      break;
    }
    data[key] = value;
  }
  data.truncated = cut ? "1" : "0";
  return PushMessageData.parse(data);
}

/**
 * FCM `data` for `dismiss` pushes covering `ids`, split so each push stays within the
 * payload limit. Empty when there is nothing to dismiss.
 */
export function toDismissData(ids: readonly string[]): DismissData[] {
  const build = (list: string): DismissData => ({
    v: PUSH_VERSION,
    kind: "dismiss",
    ids: list,
  });
  const pushes: DismissData[] = [];
  let joined = "";
  for (const id of ids) {
    const next = joined === "" ? id : `${joined},${id}`;
    if (joined !== "" && pushDataBytes(build(next)) > FCM_MAX_PAYLOAD_BYTES) {
      pushes.push(build(joined));
      joined = id;
    } else {
      joined = next;
    }
  }
  if (joined !== "") {
    pushes.push(build(joined));
  }
  return pushes.map((push) => PushDismissData.parse(push));
}
