import type { Message } from "@notifier/contract/message";

/**
 * Side effects that run after a request has done its work, such as push fan-out.
 * Calls are synchronous and fire-and-forget: the server schedules the real work with
 * `executionCtx.waitUntil`, so a slow push never delays the response.
 */
export type Dispatch = {
  /** A message was stored. Called once per published message, after the insert. */
  messagePublished: (message: Message) => void;
  /**
   * `userId` read `messageIds` (only the ones newly marked, never empty), so their
   * other devices can drop those notifications.
   */
  messagesRead: (userId: string, messageIds: string[]) => void;
};
