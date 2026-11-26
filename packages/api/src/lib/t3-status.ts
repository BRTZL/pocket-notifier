/**
 * Thread status from the T3 bridge. The bridge reports each top-level T3 Code thread when
 * its phase, title, branch or pull request changes; the status lives on the thread's
 * feature, so the app can show which threads are running or waiting. Most reports are
 * silent. A push goes out only when the user would otherwise miss something:
 *
 * - the thread failed (not after the user pressed Stop);
 * - a run of 5+ minutes finished, the agent sent no notification during it, and the user
 *   has not looked at the thread in T3 Code for the last few minutes.
 *
 * Waiting for an approval or an answer never pushes from here: T3's own mobile app does
 * that, and the user answers there.
 */
import { T3_LIMITS, type T3Phase, type T3ThreadStatusInput } from "@notifier/contract/t3";
import type { Database } from "@notifier/db";
import { feature, message, t3Bridge } from "@notifier/db/schema/notifier";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import type { Dispatch } from "../dispatch";
import type { Files } from "./files";
import { createProject, findProject, requirePublisher, sendNotification } from "./projects";
import { redactSecrets } from "./redact";
import { ensureT3Feature } from "./t3";

type FeatureRow = typeof feature.$inferSelect;
type StatusInput = Required<T3ThreadStatusInput>;

/** Sender of the bridge's own messages; agent messages are told apart by it. */
export const T3_BRIDGE_SENDER = { id: "t3-bridge", name: "T3 Code" } as const;

/** A finished run shorter than this is no news. */
export const LONG_RUN_MS = 5 * 60 * 1000;
/** A visit this shortly before the run ended, or later, means the user saw it finish. */
export const SEEN_BEFORE_END_MS = 2 * 60 * 1000;
/** Characters of the summary in a push body. */
const PUSH_SUMMARY_LENGTH = 200;
const FEATURE_NAME_LENGTH = 64;
const LINE_BREAKS = /\s*\n\s*/gu;
/** `[text](target)`: agents link local files, which mean nothing on a phone. */
const MARKDOWN_LINK = /!?\[(?<text>[^\]]*)\]\([^)]*\)/gu;
/** Emphasis, inline code and heading marks. */
const MARKDOWN_MARKS = /\*\*|__|`|^#{1,6}\s+/gmu;

/** Agent markdown as plain text: link texts without targets, no emphasis marks. */
function plainText(text: string): string {
  return text.replace(MARKDOWN_LINK, "$<text>").replace(MARKDOWN_MARKS, "");
}

/** The summary as one masked plain-text line, cut to `max` characters. */
export function summaryLine(text: string | null, max: number = T3_LIMITS.summaryLength) {
  if (!text) {
    return null;
  }
  const line = plainText(redactSecrets(text)).replace(LINE_BREAKS, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line || null;
}

export type PushDecision = { kind: "failed" | "completed" } | null;

/**
 * Whether a report is worth a push. `previous` is the phase before this report (`null` on
 * the first one, which only records the state: an old thread must not push when the
 * bridge starts). `agentSpoke` is whether the agent sent a notification during the run.
 */
export function decidePush(args: {
  previous: T3Phase | null;
  input: Pick<
    StatusInput,
    "phase" | "stopRequested" | "runStartedAt" | "runCompletedAt" | "lastVisitedAt"
  >;
  agentSpoke: boolean;
  now: Date;
}): PushDecision {
  const { previous, input } = args;
  if (previous === null || previous === input.phase || input.stopRequested) {
    return null;
  }
  if (input.phase === "failed") {
    return { kind: "failed" };
  }
  if (input.phase !== "completed" || args.agentSpoke) {
    return null;
  }
  if (!(input.runStartedAt && input.runCompletedAt)) {
    return null;
  }
  const ran = Date.parse(input.runCompletedAt) - Date.parse(input.runStartedAt);
  if (!(ran >= LONG_RUN_MS)) {
    return null;
  }
  // Seen: the user had the thread open around the time it finished, or after. A visit
  // earlier in the run says nothing about the end.
  const visited = input.lastVisitedAt ? Date.parse(input.lastVisitedAt) : Number.NaN;
  if (visited >= Date.parse(input.runCompletedAt) - SEEN_BEFORE_END_MS) {
    return null;
  }
  return { kind: "completed" };
}

/** Whether anyone but the bridge sent to the feature since `since`. */
async function agentSpokeSince(db: Database, row: FeatureRow, since: string | null) {
  if (!since) {
    return false;
  }
  const [found] = await db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.projectId, row.projectId),
        eq(message.conversationKey, `c:${row.slug}`),
        gte(message.createdAt, new Date(since)),
        sql`coalesce(json_extract(${message.senderJson}, '$.id'), '') <> ${T3_BRIDGE_SENDER.id}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** The user's project for the thread's repo, created when missing. */
async function projectFor(db: Database, userId: string, input: StatusInput) {
  const found = await findProject(db, userId, input.project.name);
  if (found && found.project.personalUserId === null) {
    requirePublisher(found);
    return found;
  }
  await createProject(db, userId, { name: input.project.name, displayName: input.project.title });
  const created = await findProject(db, userId, input.project.name);
  if (!created) {
    throw new Error(`project ${input.project.name} missing after create`);
  }
  return created;
}

/** Text from T3 that people see: secrets masked. */
function masked(text: string | null): string | null {
  return text === null ? null : redactSecrets(text);
}

/**
 * The feature's new T3 columns, and its name: always the T3 thread's title. A
 * removal only takes the thread off the board: its labels stay as they were.
 */
function statusUpdate(row: FeatureRow, input: StatusInput, now: Date) {
  if (input.removed) {
    return { t3Phase: null, t3PhaseAt: now, t3Sequence: input.sequence };
  }
  const t3Title = redactSecrets(input.title);
  // The thread is named after the T3 thread, whatever name an agent gave it first.
  const name = t3Title.slice(0, FEATURE_NAME_LENGTH);
  const phase = input.phase;
  return {
    ...(row.name === name ? {} : { name }),
    t3Title,
    t3Phase: phase,
    t3PhaseAt: row.t3Phase === phase && row.t3PhaseAt ? row.t3PhaseAt : now,
    t3Branch: masked(input.branch),
    t3PullRequestUrl: input.pullRequestUrl,
    t3Summary: summaryLine(input.summary),
    t3RunStartedAt: input.runStartedAt ? new Date(input.runStartedAt) : null,
    t3Sequence: input.sequence,
  };
}

/** The columns `statusUpdate` sets, as they were in `row`: to undo a failed push. */
function previousStatus(row: FeatureRow) {
  return {
    name: row.name,
    t3Title: row.t3Title,
    t3Phase: row.t3Phase,
    t3PhaseAt: row.t3PhaseAt,
    t3Branch: row.t3Branch,
    t3PullRequestUrl: row.t3PullRequestUrl,
    t3Summary: row.t3Summary,
    t3RunStartedAt: row.t3RunStartedAt,
    t3Sequence: row.t3Sequence,
  };
}

/** Matches the row only while its sequence is still `sequence` (compare-and-set). */
function atSequence(id: string, sequence: number | null) {
  return and(
    eq(feature.id, id),
    sequence === null ? isNull(feature.t3Sequence) : eq(feature.t3Sequence, sequence),
  );
}

/** Compare-and-set attempts before a report gives up to concurrent ones. */
const APPLY_ATTEMPTS = 5;

/**
 * Writes `input` onto the feature unless a report as new or newer is already there.
 * `before` is the row it replaced; `null` when nothing was written.
 */
async function applyStatus(db: Database, row: FeatureRow, input: StatusInput, now: Date) {
  let before = row;
  for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
    if (before.t3Sequence !== null && input.sequence <= before.t3Sequence) {
      return null;
    }
    // biome-ignore lint/performance/noAwaitInLoops: each attempt depends on the row it read.
    const [after] = await db
      .update(feature)
      .set(statusUpdate(before, input, now))
      .where(atSequence(before.id, before.t3Sequence))
      .returning();
    if (after) {
      return { before, after };
    }
    const [current] = await db.select().from(feature).where(eq(feature.id, row.id)).limit(1);
    if (!current) {
      return null;
    }
    before = current;
  }
  throw new Error(`thread ${input.threadId} changed too often to record its status`);
}

/** Whether the bridge stored a message in the feature at or after `since`. */
async function bridgeMessageSince(db: Database, row: FeatureRow, since: Date) {
  const [found] = await db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.projectId, row.projectId),
        eq(message.conversationKey, `c:${row.slug}`),
        gte(message.createdAt, since),
        sql`json_extract(${message.senderJson}, '$.id') = ${T3_BRIDGE_SENDER.id}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

function pushContent(kind: "failed" | "completed", input: StatusInput) {
  const summary = summaryLine(input.summary, PUSH_SUMMARY_LENGTH);
  if (kind === "failed") {
    const reason = [input.errorClass?.replaceAll("_", " "), summary].filter(Boolean).join(": ");
    return {
      title: "Thread failed",
      body: reason || "The agent run failed. Open it in T3 to see why.",
      priority: 4,
      tags: ["fail", "t3"],
    };
  }
  return {
    title: "Thread finished",
    body: summary ?? "The agent finished. Open it in T3 to see the result.",
    priority: 3,
    tags: ["done", "t3"],
  };
}

/**
 * Records a thread's status on its feature (creating the project and feature when
 * missing) and sends a push when `decidePush` says so.
 *
 * - A report not newer than the last accepted one (by T3 stream sequence) changes
 *   nothing: it is stale, or a retry of one already applied.
 * - The update is a compare-and-set on the sequence it read. A report that loses to a
 *   concurrent one reads again and applies unless the winner was newer, so of two
 *   reports of the same change only one moves the phase and pushes.
 * - When the push fails before its message is stored, the update is undone, so the
 *   bridge's retry pushes again. Delivery to devices is best effort, as for any message.
 */
export async function reportT3Status(
  db: Database,
  args: {
    userId: string;
    input: StatusInput;
    dispatch: Dispatch;
    files: Files;
    now?: Date;
  },
): Promise<{ project: string; feature: string; pushed: boolean }> {
  const { input, userId } = args;
  const now = args.now ?? new Date();
  const access = await projectFor(db, userId, input);
  const ensured = await ensureT3Feature(db, {
    projectId: access.project.id,
    ref: { environmentId: input.environmentId, threadId: input.threadId },
    name: redactSecrets(input.title).slice(0, FEATURE_NAME_LENGTH),
    userId,
  });
  const result = (pushed: boolean, slug = ensured.feature.slug) => ({
    project: access.project.name,
    feature: slug,
    pushed,
  });
  const applied = await applyStatus(db, ensured.feature, input, now);
  if (!applied) {
    return result(false);
  }
  const { before, after } = applied;

  const decision = input.removed
    ? null
    : decidePush({
        previous: before.t3Phase,
        input,
        agentSpoke: await agentSpokeSince(db, after, input.runStartedAt),
        now,
      });
  if (decision) {
    const content = pushContent(decision.kind, input);
    const sentFrom = new Date();
    try {
      await sendNotification(db, {
        access,
        userId,
        feature: after,
        dispatch: args.dispatch,
        files: args.files,
        input: {
          ...content,
          sender: T3_BRIDGE_SENDER,
          links: input.pullRequestUrl ? [{ label: "Open PR", url: input.pullRequestUrl }] : [],
        },
      });
    } catch (error) {
      // Stored but not announced (a later step failed): a retry must not store it again.
      if (!(await bridgeMessageSince(db, after, sentFrom))) {
        await db
          .update(feature)
          .set(previousStatus(before))
          .where(atSequence(before.id, input.sequence));
      }
      throw error;
    }
  }
  return result(decision !== null, after.slug);
}

/** Marks the user's bridge for `environmentId` as alive at `now`. */
export async function recordT3Heartbeat(
  db: Database,
  args: { userId: string; environmentId: string; now?: Date },
) {
  const now = args.now ?? new Date();
  await db
    .insert(t3Bridge)
    .values({ userId: args.userId, environmentId: args.environmentId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [t3Bridge.userId, t3Bridge.environmentId],
      set: { lastSeenAt: now },
    });
}
