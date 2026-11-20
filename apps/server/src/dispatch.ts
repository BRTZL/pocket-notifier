import type { Dispatch } from "@notifier/api/dispatch";
import type { RequestLogger } from "evlog";

/**
 * Placeholder until push delivery lands: records on the request's wide event that
 * fan-out was skipped. The real implementation sends FCM messages inside
 * `executionCtx.waitUntil`.
 */
export function createDispatch(log: RequestLogger): Dispatch {
  return {
    messagePublished: (message) => {
      log.set({
        push: { messageId: message.id, topic: message.topic, skipped: "not implemented" },
      });
    },
  };
}
