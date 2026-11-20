import { type TokenScope, TokenSecret } from "@notifier/contract/token";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { accessToken, topic, topicMember } from "@notifier/db/schema/notifier";
import { sha256Hex } from "@notifier/db/secrets";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { appError } from "../lib/errors";
import { parseTokenScope } from "../lib/token-scope";

/** RFC 6750 shape: scheme, exactly one ASCII space, the token. No other whitespace. */
const BEARER = /^Bearer (?<secret>nt_[0-9A-Za-z]{40})$/iu;

export type TokenRow = typeof accessToken.$inferSelect;
export type TokenUser = typeof user.$inferSelect;
export type TopicRow = typeof topic.$inferSelect;

/** A verified access token, its parsed scope and the user it acts for. */
export type TokenAuth = {
  token: TokenRow;
  scope: TokenScope;
  user: TokenUser;
};

function unauthorized(message: string) {
  return appError("UNAUTHORIZED", message);
}

/**
 * Verifies `Authorization: Bearer nt_...` against the stored SHA-256 hash and records
 * the use in `last_used_at`. Throws the contract's `UNAUTHORIZED` for a missing or
 * malformed header and for unknown, revoked or expired tokens.
 */
export async function authenticateToken(
  db: Database,
  authorization: string | null | undefined,
  now: Date = new Date(),
): Promise<TokenAuth> {
  if (!authorization) {
    throw unauthorized("Missing Authorization: Bearer header");
  }
  const secret = BEARER.exec(authorization)?.groups?.secret;
  if (!(secret && TokenSecret.safeParse(secret).success)) {
    throw unauthorized("Expected Authorization: Bearer nt_...");
  }

  const [row] = await db
    .select({ token: accessToken, user })
    .from(accessToken)
    .innerJoin(user, eq(user.id, accessToken.userId))
    .where(eq(accessToken.hash, await sha256Hex(secret)))
    .limit(1);
  if (!row) {
    throw unauthorized("Unknown access token");
  }
  if (row.token.revokedAt) {
    throw unauthorized("This access token was revoked");
  }
  if (row.token.expiresAt && row.token.expiresAt <= now) {
    throw unauthorized("This access token has expired");
  }
  const scope = parseTokenScope(row.token.scopeJson);
  if (!scope) {
    throw unauthorized("This access token has an unreadable scope");
  }

  // Re-checked in the write: a token revoked or expired since the lookup must not pass.
  const [used] = await db
    .update(accessToken)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(accessToken.id, row.token.id),
        isNull(accessToken.revokedAt),
        or(isNull(accessToken.expiresAt), gt(accessToken.expiresAt, now)),
      ),
    )
    .returning({ id: accessToken.id });
  if (!used) {
    throw unauthorized("This access token was revoked or has expired");
  }
  return { token: { ...row.token, lastUsedAt: now }, scope, user: row.user };
}

type Action = "publish" | "read";

async function tokenCan(
  db: Database,
  auth: TokenAuth,
  topicName: string,
  action: Action,
): Promise<TopicRow> {
  const [row] = await db
    .select({ topic, role: topicMember.role })
    .from(topic)
    .innerJoin(
      topicMember,
      and(eq(topicMember.topicId, topic.id), eq(topicMember.userId, auth.user.id)),
    )
    .where(eq(topic.name, topicName))
    .limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Topic not found");
  }

  const canPublish = row.role === "owner" || row.role === "publisher";
  // `all` means every topic where the user is owner or publisher (see access.mdx).
  const inScope = auth.scope.kind === "all" ? canPublish : auth.scope.topics.includes(topicName);
  if (!inScope) {
    throw appError("FORBIDDEN", "This token's scope does not include the topic");
  }
  if (action === "publish" && !canPublish) {
    throw appError("FORBIDDEN", "Only owners and publishers can publish to this topic");
  }
  return row.topic;
}

/** The topic if the token may publish to it: in scope, and the user is owner or publisher. */
export function tokenCanPublish(db: Database, auth: TokenAuth, topicName: string) {
  return tokenCan(db, auth, topicName, "publish");
}

/** The topic if the token may read it: in scope, and the user is a member. */
export function tokenCanRead(db: Database, auth: TokenAuth, topicName: string) {
  return tokenCan(db, auth, topicName, "read");
}
