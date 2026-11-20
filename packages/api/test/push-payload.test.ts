import type { Message } from "@notifier/contract/message";
import {
  FCM_MAX_PAYLOAD_BYTES,
  PUSH_BODY_MAX,
  PushDismissData,
  PushMessageData,
} from "@notifier/contract/push";
import { describe, expect, it } from "vitest";

import { pushDataBytes, toDismissData, toPushData } from "../src/push/payload";

const CREATED_AT = "2026-11-20T12:00:00.000Z";
const ID = "msg_01jd8x5k2m9q7r4t6v8w0y3z5a";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: ID,
    topicId: "top_01jd8x5k2m9q7r4t6v8w0y3z5a",
    topic: "ci",
    title: "main build failed",
    body: "3 tests failed in auth.spec.ts",
    priority: 5,
    tags: ["ci", "failure"],
    clickUrl: "https://github.com/acme/app/actions/runs/123",
    actions: [
      {
        type: "view",
        key: "0",
        label: "Open logs",
        url: "https://ci.example.com/runs/123",
        clear: false,
      },
    ],
    attachment: null,
    conversation: { id: "ci", iconUrl: "https://example.com/ci.png" },
    sender: { id: "github-actions", name: "GitHub Actions" },
    publishedBy: null,
    createdAt: CREATED_AT,
    expiresAt: "2026-12-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("toPushData", () => {
  it("encodes every field as a string, per the payload contract", () => {
    const data = toPushData(message());
    expect(data).toEqual({
      v: "1",
      kind: "message",
      id: ID,
      topic: "ci",
      title: "main build failed",
      body: "3 tests failed in auth.spec.ts",
      priority: "5",
      tags: "ci,failure",
      clickUrl: "https://github.com/acme/app/actions/runs/123",
      actions:
        '[{"type":"view","key":"0","label":"Open logs","url":"https://ci.example.com/runs/123","clear":false}]',
      attachment: "",
      conversationId: "ci",
      conversationTitle: "",
      conversationIcon: "https://example.com/ci.png",
      senderId: "github-actions",
      senderName: "GitHub Actions",
      senderIcon: "",
      truncated: "0",
      createdAt: String(Date.parse(CREATED_AT)),
    });
    expect(PushMessageData.safeParse(data).success).toBe(true);
    expect(Object.values(data).every((value) => typeof value === "string")).toBe(true);
  });

  it("uses empty strings for unset fields", () => {
    const data = toPushData(
      message({
        title: null,
        body: "",
        tags: [],
        clickUrl: null,
        actions: [],
        conversation: null,
        sender: null,
      }),
    );
    expect(data).toMatchObject({
      title: "",
      body: "",
      tags: "",
      clickUrl: "",
      actions: "",
      conversationId: "",
      senderId: "",
      truncated: "0",
    });
  });

  it("cuts the body to PUSH_BODY_MAX on a grapheme boundary and sets truncated", () => {
    // Family emoji: one grapheme of 11 UTF-16 code units; 999 + 11 crosses the limit.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const body = `${"a".repeat(PUSH_BODY_MAX - 1)}${family}tail`;
    const data = toPushData(message({ body, actions: [] }));
    expect(data.body).toBe("a".repeat(PUSH_BODY_MAX - 1));
    expect(data.truncated).toBe("1");
    expect(PushMessageData.safeParse(data).success).toBe(true);
  });

  it("keeps filling after a body cut at PUSH_BODY_MAX when there is budget left", () => {
    const data = toPushData(message({ body: "x".repeat(1500) }));
    expect(data.body).toBe("x".repeat(PUSH_BODY_MAX));
    expect(data.actions).not.toBe("");
    expect(data.tags).toBe("ci,failure");
    expect(data.senderName).toBe("GitHub Actions");
    expect(data.conversationIcon).toBe("https://example.com/ci.png");
    expect(data.truncated).toBe("1");
  });

  it("keeps a body of exactly PUSH_BODY_MAX whole", () => {
    const data = toPushData(message({ body: "b".repeat(PUSH_BODY_MAX) }));
    expect(data.body).toHaveLength(PUSH_BODY_MAX);
    expect(data.truncated).toBe("0");
  });

  it("stays within 4096 bytes of UTF-8 JSON, cutting a multi-byte body to the space left", () => {
    // 4-byte characters: 1000 code units of these is 2000 bytes. Control characters
    // in the earlier fields are 6 bytes each once JSON-escaped, leaving less than that.
    const body = "\u{1F600}".repeat(PUSH_BODY_MAX / 2);
    const title = "\u0001".repeat(250);
    const data = toPushData(
      message({
        body,
        title,
        conversation: { id: "ci", title: "\u0001".repeat(64) },
        sender: { id: "bot", name: "\u0001".repeat(40) },
      }),
    );
    expect(pushDataBytes(data)).toBeLessThanOrEqual(FCM_MAX_PAYLOAD_BYTES);
    expect(data.title).toBe(title);
    expect(data.body.length).toBeLessThan(body.length);
    expect(body.startsWith(data.body)).toBe(true);
    // Never splits a surrogate pair.
    expect(data.body.length % 2).toBe(0);
    expect(data.truncated).toBe("1");
    // Nothing after the body in fill order is added once the body was cut.
    expect(data).toMatchObject({ actions: "", tags: "", clickUrl: "", conversationIcon: "" });
  });

  it("leaves actions out whole when they do not fit, and stops filling after them", () => {
    const url = `https://ci.example.com/${"x".repeat(1900)}`;
    const actions = [0, 1, 2].map((index) => ({
      type: "view" as const,
      key: String(index),
      label: `Open ${index}`,
      url,
      clear: false,
    }));
    const data = toPushData(message({ actions }));
    expect(data.actions).toBe("");
    expect(data.body).toBe("3 tests failed in auth.spec.ts");
    expect(data.tags).toBe("");
    expect(data.clickUrl).toBe("");
    expect(data.truncated).toBe("1");
    expect(pushDataBytes(data)).toBeLessThanOrEqual(FCM_MAX_PAYLOAD_BYTES);
  });

  it("measures JSON escaping, not just string length", () => {
    // Control characters are 1 byte raw but 6 bytes as `\u0001` in JSON.
    const body = "\u0001".repeat(PUSH_BODY_MAX);
    const data = toPushData(message({ body, title: "\u0001".repeat(250) }));
    expect(pushDataBytes(data)).toBeLessThanOrEqual(FCM_MAX_PAYLOAD_BYTES);
    expect(data.truncated).toBe("1");
  });
});

describe("toDismissData", () => {
  it("is empty for no ids and one push for a few", () => {
    expect(toDismissData([])).toEqual([]);
    expect(toDismissData(["msg_a", "msg_b"])).toEqual([
      { v: "1", kind: "dismiss", ids: "msg_a,msg_b" },
    ]);
  });

  it("splits long id lists into pushes that each fit the budget, keeping every id once", () => {
    const ids = Array.from(
      { length: 600 },
      (_, index) => `${ID.slice(0, -4)}${String(index).padStart(4, "0")}`,
    );
    const pushes = toDismissData(ids);
    expect(pushes.length).toBeGreaterThan(1);
    for (const push of pushes) {
      expect(PushDismissData.safeParse(push).success).toBe(true);
      expect(pushDataBytes(push)).toBeLessThanOrEqual(FCM_MAX_PAYLOAD_BYTES);
    }
    expect(pushes.flatMap((push) => push.ids.split(","))).toEqual(ids);
  });
});
