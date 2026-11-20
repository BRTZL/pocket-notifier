import { z } from "zod";

import { idSchema, Timestamp } from "./common";
import { TopicName } from "./topic";

export const TokenId = idSchema("token");

/** Secrets look like `nt_<40 base62 chars>`; only a hash is stored. */
export const TOKEN_PREFIX = "nt_";

export const TokenSecret = z.string().regex(/^nt_[0-9A-Za-z]{40}$/u, "Not a notifier token");

/** Which topics a token may publish to and read from. */
export const TokenScope = z.discriminatedUnion("kind", [
  /** Every topic where the token's user is `owner` or `publisher`, including future ones. */
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("topics"), topics: z.array(TopicName).min(1).max(50) }),
]);
export type TokenScope = z.infer<typeof TokenScope>;

export const AccessToken = z.object({
  id: TokenId,
  name: z.string().min(1).max(80),
  /** First characters of the secret, e.g. `nt_a1b2`, to recognise it in lists. */
  start: z.string(),
  scope: TokenScope,
  expiresAt: Timestamp.nullable(),
  lastUsedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type AccessToken = z.infer<typeof AccessToken>;

export const CreateTokenInput = z.object({
  name: z.string().min(1).max(80),
  scope: TokenScope,
  /** Omit for a token that never expires. */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** The only response that ever contains the secret. */
export const CreateTokenOutput = z.object({
  token: AccessToken,
  secret: TokenSecret,
});
