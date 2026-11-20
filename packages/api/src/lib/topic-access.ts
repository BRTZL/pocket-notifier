import type { TopicRole } from "@notifier/contract/topic";
import type { Database } from "@notifier/db";
import { topicMember } from "@notifier/db/schema/notifier";
import { and, eq } from "drizzle-orm";

import { appError } from "./errors";

export type Membership = {
  topicId: string;
  userId: string;
  role: TopicRole;
};

/**
 * Loads the caller's membership in a topic. Throws `NOT_FOUND` when there is none, so
 * non-members cannot tell a missing topic from one they cannot see.
 */
export async function requireMember(
  db: Database,
  topicId: string,
  userId: string,
): Promise<Membership> {
  const [row] = await db
    .select({ topicId: topicMember.topicId, userId: topicMember.userId, role: topicMember.role })
    .from(topicMember)
    .where(and(eq(topicMember.topicId, topicId), eq(topicMember.userId, userId)))
    .limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Topic not found");
  }
  return row;
}

/** Like `requireMember`, and throws `FORBIDDEN` unless the caller is an owner. */
export async function requireOwner(
  db: Database,
  topicId: string,
  userId: string,
): Promise<Membership> {
  const membership = await requireMember(db, topicId, userId);
  if (membership.role !== "owner") {
    throw appError("FORBIDDEN", "Only a topic owner can do this");
  }
  return membership;
}
