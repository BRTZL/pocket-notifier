import { z } from "zod";

/**
 * T3 Code threads. An agent running in a T3 Code thread passes its thread here
 * (`$T3CODE_THREAD_ID`, and the id in `~/.t3/userdata/environment-id`), so every message
 * from that thread lands in one feature and links back to the thread: the user replies in
 * T3 Code, on the desktop or in its mobile app.
 */

/** T3 ids: UUIDs, or prefixed ids like `thread:delegated-task:…`. */
const T3Id = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u, "Use the id as T3 Code shows it");

export const T3ThreadRef = z.object({
  /** The T3 environment (one per T3 server), from `~/.t3/userdata/environment-id`. */
  environmentId: T3Id,
  /** The thread, from `$T3CODE_THREAD_ID`. */
  threadId: T3Id,
});
export type T3ThreadRef = z.infer<typeof T3ThreadRef>;

/** Opens the thread in T3 Code: the desktop app, or T3's mobile app on a phone. */
export function t3ThreadUrl(ref: T3ThreadRef): string {
  return `t3code://threads/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`;
}

/** A feature's T3 thread, as the app sees it. */
export const T3ThreadLink = T3ThreadRef.extend({
  /** `t3code://threads/<environmentId>/<threadId>`. */
  url: z.string(),
});
export type T3ThreadLink = z.infer<typeof T3ThreadLink>;

/** Label of the button that opens the thread in T3 Code. */
export const OPEN_IN_T3_LABEL = "Open in T3";
