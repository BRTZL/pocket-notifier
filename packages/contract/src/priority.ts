import { z } from "zod";

/**
 * Message priority, 1 (lowest) to 5 (highest). On Android each level maps to its
 * own notification channel; see `ANDROID_CHANNELS` in `./push`.
 */
export const Priority = z.number().int().min(1).max(5);
export type Priority = z.infer<typeof Priority>;

export const DEFAULT_PRIORITY = 3 satisfies Priority;

export const PRIORITY_NAMES = {
  1: "min",
  2: "low",
  3: "default",
  4: "high",
  5: "urgent",
} as const satisfies Record<Priority, string>;
