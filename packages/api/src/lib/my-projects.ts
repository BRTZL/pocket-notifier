import type { MyProject } from "@notifier/contract/project";
import type { Database } from "@notifier/db";
import {
  message,
  messageRead,
  project,
  projectMember,
  subscription,
} from "@notifier/db/schema/notifier";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { appError } from "./errors";
import { type ProjectStats, toMyProject } from "./serialize";

const EMPTY_STATS: ProjectStats = { unreadCount: 0, lastMessageAt: null };

/**
 * The caller's projects as `MyProject`, ordered by name. Two queries in total: memberships
 * with their project and subscription, then unread counts and last message times for
 * all of them at once. Pass `projectId` to load just one.
 */
export async function loadMyProjects(
  db: Database,
  userId: string,
  projectId?: string,
): Promise<MyProject[]> {
  const memberFilter = projectId
    ? and(eq(projectMember.userId, userId), eq(projectMember.projectId, projectId))
    : eq(projectMember.userId, userId);

  const [rows, statRows] = await db.batch([
    db
      .select({
        project,
        role: projectMember.role,
        subscriptionProjectId: subscription.projectId,
        muted: subscription.muted,
      })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .leftJoin(
        subscription,
        and(eq(subscription.projectId, projectMember.projectId), eq(subscription.userId, userId)),
      )
      .where(memberFilter)
      .orderBy(asc(project.name)),
    db
      .select({
        projectId: message.projectId,
        unreadCount: sql<number>`sum(case when ${messageRead.messageId} is null then 1 else 0 end)`,
        lastMessageAt: sql<number | null>`max(${message.createdAt})`,
      })
      .from(message)
      .innerJoin(
        projectMember,
        and(eq(projectMember.projectId, message.projectId), eq(projectMember.userId, userId)),
      )
      .leftJoin(
        messageRead,
        and(eq(messageRead.messageId, message.id), eq(messageRead.userId, userId)),
      )
      .where(and(memberFilter, gt(message.expiresAt, new Date())))
      .groupBy(message.projectId),
  ]);

  const stats = new Map<string, ProjectStats>(
    statRows.map((row) => [
      row.projectId,
      {
        unreadCount: Number(row.unreadCount),
        lastMessageAt: row.lastMessageAt === null ? null : new Date(row.lastMessageAt),
      },
    ]),
  );

  return rows.map((row) =>
    toMyProject(
      row.project,
      {
        role: row.role,
        subscribed: row.subscriptionProjectId !== null,
        muted: row.muted ?? false,
      },
      stats.get(row.project.id) ?? EMPTY_STATS,
    ),
  );
}

/** One of the caller's projects; `NOT_FOUND` when they are not a member. */
export async function loadMyProject(
  db: Database,
  userId: string,
  projectId: string,
): Promise<MyProject> {
  const [found] = await loadMyProjects(db, userId, projectId);
  if (!found) {
    throw appError("NOT_FOUND", "Project not found");
  }
  return found;
}
