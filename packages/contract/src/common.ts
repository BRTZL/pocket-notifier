import { z } from "zod";

/**
 * Prefixes for notifier-owned resource IDs. IDs are `<prefix>_<26 char base32>`.
 * User IDs come from better-auth and use its own format.
 */
export const ID_PREFIXES = {
  topic: "top",
  message: "msg",
  attachment: "att",
  response: "rsp",
  token: "tok",
  invite: "inv",
  device: "dev",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function idSchema(kind: IdKind) {
  return z
    .string()
    .regex(new RegExp(`^${ID_PREFIXES[kind]}_[0-9a-z]{26}$`, "u"), `Expected a ${kind} id`);
}

export const UserId = z.string().min(1).max(64);

/** ISO-8601 timestamp in UTC, e.g. `2026-11-20T12:00:00.000Z`. */
export const Timestamp = z.iso.datetime({ offset: false });

export const PAGE_SIZE = { default: 50, max: 100 } as const;

export const PageInput = z.object({
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE.max).default(PAGE_SIZE.default),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    /** `null` when there are no more items. */
    nextCursor: z.string().nullable(),
  });
}

export const UserSummary = z.object({
  id: UserId,
  name: z.string(),
  email: z.email(),
  image: z.url().nullable(),
});
export type UserSummary = z.infer<typeof UserSummary>;
