/**
 * Features that follow a T3 Code thread. Every message an agent sends from one T3 thread
 * lands in the same feature, found by the thread id; the feature name the agent passes only
 * names a feature the first time.
 */
import { type T3ThreadLink, type T3ThreadRef, t3ThreadUrl } from "@notifier/contract/t3";
import type { Database } from "@notifier/db";
import { feature } from "@notifier/db/schema/notifier";
import { and, eq, isNull } from "drizzle-orm";

import { ensureFeature } from "./features";

type FeatureRow = typeof feature.$inferSelect;
type Ensured = { feature: FeatureRow; created: boolean };

/** The app's view of a feature's T3 thread columns; `null` when it follows none. */
export function t3Link(environmentId: string | null, threadId: string | null): T3ThreadLink | null {
  if (!(environmentId && threadId)) {
    return null;
  }
  const ref = { environmentId, threadId };
  return { ...ref, url: t3ThreadUrl(ref) };
}

/** Characters of the thread id used in a generated slug, e.g. `t3-352b089c`. */
const SHORT_ID_LENGTH = 8;
const NOT_SLUG = /[^a-z0-9]/gu;
/** Name of a feature created for a thread when the agent passed none. */
const UNNAMED_THREAD = "T3 thread";

/** The thread id's tail as slug characters: UUIDs differ in their first characters. */
function shortThreadId(threadId: string): string {
  const id = threadId.split(":").at(-1) ?? threadId;
  return id.toLowerCase().replace(NOT_SLUG, "").slice(0, SHORT_ID_LENGTH) || "thread";
}

async function findByThread(
  db: Database,
  projectId: string,
  ref: T3ThreadRef,
): Promise<FeatureRow | undefined> {
  const [row] = await db
    .select()
    .from(feature)
    .where(
      and(
        eq(feature.projectId, projectId),
        eq(feature.t3EnvironmentId, ref.environmentId),
        eq(feature.t3ThreadId, ref.threadId),
      ),
    )
    .limit(1);
  return row;
}

/** Links `row` to the thread unless it already follows one; the linked row, else `undefined`. */
async function link(
  db: Database,
  row: FeatureRow,
  ref: T3ThreadRef,
): Promise<FeatureRow | undefined> {
  if (row.t3ThreadId !== null) {
    return row.t3EnvironmentId === ref.environmentId && row.t3ThreadId === ref.threadId
      ? row
      : undefined;
  }
  const [updated] = await db
    .update(feature)
    .set({ t3EnvironmentId: ref.environmentId, t3ThreadId: ref.threadId })
    .where(and(eq(feature.id, row.id), isNull(feature.t3ThreadId)))
    .returning()
    // The unique index refuses a second feature for the thread: a concurrent send won.
    .catch(() => []);
  return updated;
}

/**
 * The feature of `projectId` that follows `ref`, created or linked when missing.
 *
 * - A feature already following the thread: that one, whatever `name` says.
 * - Else the feature `name` names (created when missing), linked to the thread unless it
 *   follows another thread.
 * - Else (no `name`, or its feature follows another thread) a feature with the thread's
 *   short id in its slug, e.g. `login-flow-352b089c` or `t3-352b089c`.
 */
export async function ensureT3Feature(
  db: Database,
  args: { projectId: string; ref: T3ThreadRef; name?: string; userId: string | null },
): Promise<Ensured> {
  const existing = await findByThread(db, args.projectId, args.ref);
  if (existing) {
    return { feature: existing, created: false };
  }
  const name = args.name?.trim();
  const short = shortThreadId(args.ref.threadId);
  const keys = name ? [name, `${name} ${short}`] : [`t3-${short}`];
  for (const key of keys) {
    // biome-ignore lint/performance/noAwaitInLoops: the second key is only tried when the first is taken.
    const ensured = await ensureFeature(db, {
      projectId: args.projectId,
      key,
      name: name ?? UNNAMED_THREAD,
      userId: args.userId,
    });
    const linked = await link(db, ensured.feature, args.ref);
    if (linked) {
      return { feature: linked, created: ensured.created };
    }
    const raced = await findByThread(db, args.projectId, args.ref);
    if (raced) {
      return { feature: raced, created: false };
    }
  }
  throw new Error(`no feature could follow T3 thread ${args.ref.threadId}`);
}
