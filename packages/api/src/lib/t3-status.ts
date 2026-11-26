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
import { and, eq, gte, sql } from "drizzle-orm";

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
/** The user opened the thread this recently: they saw it finish. */
export const RECENT_VISIT_MS = 5 * 60 * 1000;
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
  const visited = input.lastVisitedAt ? Date.parse(input.lastVisitedAt) : Number.NaN;
  if (args.now.getTime() - visited < RECENT_VISIT_MS) {
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

/** The feature's new T3 columns, and its name when it still carries T3's old title. */
function statusUpdate(row: FeatureRow, input: StatusInput, now: Date) {
  const title = input.title.slice(0, FEATURE_NAME_LENGTH);
  const namedAfterT3 =
    row.t3Title === null || row.name === row.t3Title.slice(0, FEATURE_NAME_LENGTH);
  return {
    ...(namedAfterT3 && row.name !== title ? { name: title } : {}),
    t3Title: input.title,
    t3Phase: input.phase,
    t3PhaseAt: row.t3Phase === input.phase && row.t3PhaseAt ? row.t3PhaseAt : now,
    t3Branch: input.branch,
    t3PullRequestUrl: input.pullRequestUrl,
    t3Summary: summaryLine(input.summary),
    t3RunStartedAt: input.runStartedAt ? new Date(input.runStartedAt) : null,
  };
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
    name: input.title.slice(0, FEATURE_NAME_LENGTH),
    userId,
  });
  const before = ensured.feature;
  const [after] = await db
    .update(feature)
    .set(statusUpdate(before, input, now))
    .where(eq(feature.id, before.id))
    .returning();
  const row = after ?? before;

  const decision = decidePush({
    previous: before.t3Phase,
    input,
    agentSpoke: await agentSpokeSince(db, row, input.runStartedAt),
    now,
  });
  if (decision) {
    const content = pushContent(decision.kind, input);
    await sendNotification(db, {
      access,
      userId,
      feature: row,
      dispatch: args.dispatch,
      files: args.files,
      input: {
        ...content,
        sender: T3_BRIDGE_SENDER,
        links: input.pullRequestUrl ? [{ label: "Open PR", url: input.pullRequestUrl }] : [],
      },
    });
  }
  return { project: access.project.name, feature: row.slug, pushed: decision !== null };
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
