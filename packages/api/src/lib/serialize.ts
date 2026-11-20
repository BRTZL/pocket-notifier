import type { UserSummary } from "@notifier/contract/common";
import type { MyTopic, TopicMember, TopicRole } from "@notifier/contract/topic";
import type { topic } from "@notifier/db/schema/notifier";

type UserRow = {
  id: string;
  name: string;
  email: string;
  image?: string | null | undefined;
};

export function toUserSummary(row: UserRow): UserSummary {
  return { id: row.id, name: row.name, email: row.email, image: row.image ?? null };
}

export type TopicStats = {
  unreadCount: number;
  lastMessageAt: Date | null;
};

export function toMyTopic(
  row: typeof topic.$inferSelect,
  membership: { role: TopicRole; subscribed: boolean; muted: boolean },
  stats: TopicStats,
): MyTopic {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    defaultPriority: row.defaultPriority,
    retentionDays: row.retentionDays,
    createdAt: row.createdAt.toISOString(),
    role: membership.role,
    subscribed: membership.subscribed,
    muted: membership.muted,
    unreadCount: stats.unreadCount,
    lastMessageAt: stats.lastMessageAt?.toISOString() ?? null,
  };
}

export function toTopicMember(row: {
  topicId: string;
  role: TopicRole;
  addedAt: Date;
  user: UserRow;
}): TopicMember {
  return {
    topicId: row.topicId,
    user: toUserSummary(row.user),
    role: row.role,
    addedAt: row.addedAt.toISOString(),
  };
}
