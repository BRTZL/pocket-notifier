import { z } from "zod";

import { Timestamp } from "./common";
import { ProjectName } from "./project";

/**
 * T3 Code threads. An agent running in a T3 Code thread passes its thread here
 * (`$T3CODE_THREAD_ID`, and the id in `~/.t3/userdata/environment-id`), so every message
 * from that thread lands in one feature and links back to the thread: the user replies in
 * T3 Code, on the desktop or in its mobile app.
 */

/** T3 ids: UUIDs, or prefixed ids like `thread:delegated-task:…`. */
const T3Id = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u, "Use the id as T3 Code shows it");

export const T3ThreadRef = z.object({
  /** The T3 environment (one per T3 server), from `~/.t3/userdata/environment-id`. */
  environmentId: T3Id,
  /** The thread, from `$T3CODE_THREAD_ID`. */
  threadId: T3Id,
});
export type T3ThreadRef = z.infer<typeof T3ThreadRef>;

/**
 * The only `t3code:` links messages may carry: `t3code://threads/<environment>/<thread>`,
 * no query or fragment. T3 Code opens other routes too; publishers get none of them.
 */
export const T3_THREAD_URL =
  /^t3code:\/\/threads\/[A-Za-z0-9._~%-]{1,600}\/[A-Za-z0-9._~%-]{1,600}$/u;

/** Opens the thread in T3 Code: the desktop app, or T3's mobile app on a phone. */
export function t3ThreadUrl(ref: T3ThreadRef): string {
  return `t3code://threads/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`;
}

/**
 * Where a T3 thread stands, as T3 Code's own notifications see it
 * (`projectThreadAwarenessV2` in T3 Code): working, waiting on the user, or ended.
 */
export const T3Phase = z.enum([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
  "idle",
]);
export type T3Phase = z.infer<typeof T3Phase>;

/** A feature's T3 thread, as the app sees it. */
export const T3ThreadLink = T3ThreadRef.extend({
  /** `t3code://threads/<environmentId>/<threadId>`. */
  url: z.string(),
  /** Where the thread stands, from the T3 bridge; `null` without a bridge. */
  phase: T3Phase.nullable(),
  phaseAt: Timestamp.nullable(),
  branch: z.string().nullable(),
  pullRequestUrl: z.string().nullable(),
  /** The agent's last reply or the error, one line. */
  summary: z.string().nullable(),
});
export type T3ThreadLink = z.infer<typeof T3ThreadLink>;

/** Label of the button that opens the thread in T3 Code. */
export const OPEN_IN_T3_LABEL = "Open in T3";

/** Phases where the agent waits for the user. */
export const T3_WAITING_PHASES: readonly T3Phase[] = ["waiting_for_approval", "waiting_for_input"];

export const T3_LIMITS = {
  titleLength: 200,
  branchLength: 255,
  summaryLength: 500,
} as const;

/** T3's failure classes (`OrchestrationV2ProviderFailureClass`); anything else is `unknown`. */
export const T3ErrorClass = z.enum([
  "usage_limit",
  "provider_error",
  "transport_error",
  "permission_error",
  "validation_error",
  "unknown",
]);

/** An https URL without credentials in it. */
const PublicHttpsUrl = z
  .url({ protocol: /^https$/u })
  .max(2048)
  .refine((url) => {
    const parsed = new URL(url);
    return parsed.username === "" && parsed.password === "";
  }, "The URL must not contain credentials");

/**
 * What the T3 bridge reports for one top-level thread whenever its phase, title, branch or
 * pull request changes (`POST /v1/t3/threads`). The server keeps it on the thread's
 * feature, creating the project and feature when missing, and decides whether the change
 * is worth a push: a failure, or a long run that finished without the agent saying so.
 */
export const T3ThreadStatusInput = T3ThreadRef.extend({
  /** The repo's project: `name` is the workspace folder as a slug, `title` T3's name. */
  project: z.object({
    name: ProjectName,
    title: z.string().trim().min(1).max(80),
  }),
  title: z.string().trim().min(1).max(T3_LIMITS.titleLength),
  phase: T3Phase,
  branch: z.string().max(T3_LIMITS.branchLength).nullable().default(null),
  pullRequestUrl: PublicHttpsUrl.nullable().default(null),
  /** The latest run's start and end, ISO 8601. */
  runStartedAt: Timestamp.nullable().default(null),
  runCompletedAt: Timestamp.nullable().default(null),
  /** The user pressed Stop on the latest run: its end is no news. */
  stopRequested: z.boolean().default(false),
  /** When the user last opened the thread in T3 Code. */
  lastVisitedAt: Timestamp.nullable().default(null),
  /** One line: the agent's last reply for `completed`, the error for `failed`. */
  summary: z.string().max(T3_LIMITS.summaryLength).nullable().default(null),
  errorClass: T3ErrorClass.nullable().default(null),
  /**
   * The T3 stream sequence this report reflects. A report older than the last one the
   * server accepted for the thread is ignored, so a delayed retry never undoes news.
   */
  sequence: z.number().int().min(0),
  /** The thread was archived or deleted in T3: it leaves the board. */
  removed: z.boolean().default(false),
});
export type T3ThreadStatusInput = z.input<typeof T3ThreadStatusInput>;

export const T3ThreadStatusOutput = z.object({
  project: z.string(),
  feature: z.string(),
  /** Whether this report sent a push. */
  pushed: z.boolean(),
});

/** The bridge is alive (`POST /v1/t3/heartbeat`); the app shows when it went quiet. */
export const T3HeartbeatInput = z.object({ environmentId: T3Id });

/** One thread on the board: the feature that follows it, and where it stands. */
export const T3BoardThread = z.object({
  projectId: z.string(),
  project: ProjectName,
  /** The project's display name, else its name. */
  projectTitle: z.string(),
  iconUrl: z.string().nullable(),
  /** The feature's conversation key, `c:<slug>`. */
  key: z.string(),
  name: z.string(),
  /** Whether the conversation has messages to open; else only T3 has something to show. */
  hasMessages: z.boolean(),
  t3: T3ThreadLink,
});
export type T3BoardThread = z.infer<typeof T3BoardThread>;

export const T3Board = z.object({
  /** The newest heartbeat of the caller's bridges; `null` when none ever reported. */
  bridgeSeenAt: Timestamp.nullable(),
  /**
   * Threads waiting on the user first, then failed, running and finished ones; each group
   * newest first. Running and waiting threads always show; ended ones for a day.
   */
  threads: z.array(T3BoardThread),
});
export type T3Board = z.infer<typeof T3Board>;
