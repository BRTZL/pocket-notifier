/**
 * The board: the caller's T3 Code threads as the T3 bridge last reported them, so the app
 * can show what runs and what waits on the user at a glance.
 */
import type { T3Board, T3BoardThread, T3Phase } from "@notifier/contract/t3";
import type { Database } from "@notifier/db";
import { feature, message, project, projectMember, t3Bridge } from "@notifier/db/schema/notifier";
import { and, desc, eq, gt, inArray, isNotNull, max, or, sql } from "drizzle-orm";

import { notExpired } from "./messages";
import { t3Columns, t3Link } from "./t3";

/** Ended threads stay on the board this long. */
export const ENDED_SHOWN_MS = 24 * 60 * 60 * 1000;
const BOARD_LIMIT = 50;
const LIVE_PHASES: T3Phase[] = ["starting", "running", "waiting_for_approval", "waiting_for_input"];

/** Board order: what needs the user, then failures, work in progress, and the rest. */
const PHASE_RANK: Record<T3Phase, number> = {
  waiting_for_input: 0,
  waiting_for_approval: 0,
  failed: 1,
  starting: 2,
  running: 2,
  completed: 3,
  idle: 4,
};

export async function t3Board(db: Database, userId: string, now = new Date()): Promise<T3Board> {
  const rows = await db
    .select({
      projectId: project.id,
      project: project.name,
      projectDisplayName: project.displayName,
      iconUrl: project.iconUrl,
      slug: feature.slug,
      name: feature.name,
      ...t3Columns,
      hasMessages: sql<number>`exists (select 1 from ${message} where ${message.projectId} = ${feature.projectId} and ${message.conversationKey} = 'c:' || ${feature.slug} and ${notExpired()})`,
    })
    .from(feature)
    .innerJoin(project, eq(project.id, feature.projectId))
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, feature.projectId), eq(projectMember.userId, userId)),
    )
    .where(
      and(
        isNotNull(feature.t3Phase),
        or(
          inArray(feature.t3Phase, LIVE_PHASES),
          gt(feature.t3PhaseAt, new Date(now.getTime() - ENDED_SHOWN_MS)),
        ),
      ),
    )
    .orderBy(desc(feature.t3PhaseAt))
    .limit(BOARD_LIMIT);

  const threads: T3BoardThread[] = [];
  for (const row of rows) {
    const t3 = t3Link(row);
    if (t3) {
      threads.push({
        projectId: row.projectId,
        project: row.project,
        projectTitle: row.projectDisplayName ?? row.project,
        iconUrl: row.iconUrl,
        key: `c:${row.slug}`,
        name: row.name,
        hasMessages: Boolean(row.hasMessages),
        t3,
      });
    }
  }
  // Stable: within a rank, the query's newest-first order stays.
  threads.sort((a, b) => PHASE_RANK[a.t3.phase ?? "idle"] - PHASE_RANK[b.t3.phase ?? "idle"]);

  const [bridge] = await db
    .select({ seenAt: max(t3Bridge.lastSeenAt) })
    .from(t3Bridge)
    .where(eq(t3Bridge.userId, userId));
  const seenAt = bridge?.seenAt as Date | number | null | undefined;
  return {
    bridgeSeenAt: seenAt ? new Date(seenAt).toISOString() : null,
    threads,
  };
}
