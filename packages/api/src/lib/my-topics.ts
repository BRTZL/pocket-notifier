import type { MyTopic } from "@notifier/contract/topic";
import type { Database } from "@notifier/db";
import {
  message,
  messageRead,
  subscription,
  topic,
  topicMember,
} from "@notifier/db/schema/notifier";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { appError } from "./errors";
import { type TopicStats, toMyTopic } from "./serialize";

const EMPTY_STATS: TopicStats = { unreadCount: 0, lastMessageAt: null };

/**
 * The caller's topics as `MyTopic`, ordered by name. Two queries in total: memberships
 * with their topic and subscription, then unread counts and last message times for
 * all of them at once. Pass `topicId` to load just one.
 */
export async function loadMyTopics(
  db: Database,
  userId: string,
  topicId?: string,
): Promise<MyTopic[]> {
  const memberFilter = topicId
    ? and(eq(topicMember.userId, userId), eq(topicMember.topicId, topicId))
    : eq(topicMember.userId, userId);

  const [rows, statRows] = await db.batch([
    db
      .select({
        topic,
        role: topicMember.role,
        subscriptionTopicId: subscription.topicId,
        muted: subscription.muted,
      })
      .from(topicMember)
      .innerJoin(topic, eq(topic.id, topicMember.topicId))
      .leftJoin(
        subscription,
        and(eq(subscription.topicId, topicMember.topicId), eq(subscription.userId, userId)),
      )
      .where(memberFilter)
      .orderBy(asc(topic.name)),
    db
      .select({
        topicId: message.topicId,
        unreadCount: sql<number>`sum(case when ${messageRead.messageId} is null then 1 else 0 end)`,
        lastMessageAt: sql<number | null>`max(${message.createdAt})`,
      })
      .from(message)
      .innerJoin(
        topicMember,
        and(eq(topicMember.topicId, message.topicId), eq(topicMember.userId, userId)),
      )
      .leftJoin(
        messageRead,
        and(eq(messageRead.messageId, message.id), eq(messageRead.userId, userId)),
      )
      .where(and(memberFilter, gt(message.expiresAt, new Date())))
      .groupBy(message.topicId),
  ]);

  const stats = new Map<string, TopicStats>(
    statRows.map((row) => [
      row.topicId,
      {
        unreadCount: Number(row.unreadCount),
        lastMessageAt: row.lastMessageAt === null ? null : new Date(row.lastMessageAt),
      },
    ]),
  );

  return rows.map((row) =>
    toMyTopic(
      row.topic,
      {
        role: row.role,
        subscribed: row.subscriptionTopicId !== null,
        muted: row.muted ?? false,
      },
      stats.get(row.topic.id) ?? EMPTY_STATS,
    ),
  );
}

/** One of the caller's topics; `NOT_FOUND` when they are not a member. */
export async function loadMyTopic(db: Database, userId: string, topicId: string): Promise<MyTopic> {
  const [found] = await loadMyTopics(db, userId, topicId);
  if (!found) {
    throw appError("NOT_FOUND", "Topic not found");
  }
  return found;
}
