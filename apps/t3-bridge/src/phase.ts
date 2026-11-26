/**
 * What the bridge reports for a T3 Code thread. The phase rules follow T3 Code's own
 * notifications (`projectThreadAwarenessV2` in packages/shared/src/agentAwareness.ts of
 * T3 Code, MIT licensed), so a thread is "waiting" or "completed" here exactly when T3
 * says so.
 */

/** The fields of T3's `OrchestrationV2ThreadShell` the bridge reads. Others are ignored. */
export type ThreadShell = {
  id: string;
  projectId: string;
  title: string;
  branch?: string | null;
  status?: string;
  activityRunStatus?: string | null;
  pendingRuntimeRequest?: { kind: string } | null;
  pendingBackgroundTasks?: readonly { kind: string; awaited?: boolean }[];
  latestRunStartedAt?: string | null;
  latestRunCompletedAt?: string | null;
  latestRunStopRequested?: boolean;
  lastError?: string | null;
  lastErrorClass?: string | null;
  lastVisitedAt?: string | null;
  linkedPullRequest?: { url: string } | null;
  branchPullRequest?: { url: string } | null;
  pullRequests?: readonly { url: string; source?: string }[];
  lineage?: { relationshipToParent?: string | null; sideChat?: boolean } | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  updatedAt?: string;
};

/** The fields of T3's `OrchestrationProjectShell` the bridge reads. */
export type ProjectShell = { id: string; title: string; workspaceRoot: string };

export type Phase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "idle";

/** Subagent threads and side chats are not shown as threads in T3; skip them too. */
export function isListedThread(thread: ThreadShell): boolean {
  return (
    thread.lineage?.relationshipToParent !== "subagent" &&
    thread.lineage?.sideChat !== true &&
    !thread.archivedAt &&
    !thread.deletedAt
  );
}

/** Background work the agent waits for keeps a finished run "running". */
function backgroundWorkHoldsCompletion(tasks: ThreadShell["pendingBackgroundTasks"]): boolean {
  return (tasks ?? []).some(
    (task) => task.awaited === true || task.kind === "subagent" || task.kind === "background_task",
  );
}

/** The thread's phase, as T3's notifications would show it; `idle` when they show none. */
export function phaseOf(thread: ThreadShell): Phase {
  const request = thread.pendingRuntimeRequest;
  if (request?.kind === "user_input") {
    return "waiting_for_input";
  }
  if (request && request.kind !== "auth_refresh") {
    return "waiting_for_approval";
  }
  switch (thread.activityRunStatus ?? thread.status) {
    case "preparing":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      return backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks) ? "running" : "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

const COMBINING_MARKS = /\p{M}/gu;
/** Turkish ı has no decomposition to i. */
const DOTLESS_I = /ı/gu;
const NOT_NAME = /[^a-z0-9_-]+/gu;
const EDGE_DASHES = /^[-_]+|[-_]+$/gu;
const PROJECT_NAME_LENGTH = 64;
const PATH_SEPARATOR = /[\\/]/u;

/**
 * The Pocket Notifier project for a T3 project: the workspace folder's name as a slug
 * (`~/code/my-app` is `my-app`), as agents name projects after the repo folder.
 */
export function projectName(project: ProjectShell): string {
  const folder = project.workspaceRoot.split(PATH_SEPARATOR).filter(Boolean).at(-1) ?? "";
  for (const candidate of [folder, project.title]) {
    const slug = candidate
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase()
      .replace(DOTLESS_I, "i")
      .replace(NOT_NAME, "-")
      .replace(EDGE_DASHES, "")
      .slice(0, PROJECT_NAME_LENGTH)
      .replace(EDGE_DASHES, "");
    if (slug) {
      return slug;
    }
  }
  return "t3";
}

/** The thread's pull request: the one linked in T3, else the branch's, else the newest. */
export function pullRequestUrl(thread: ThreadShell): string | null {
  const url =
    thread.linkedPullRequest?.url ??
    thread.branchPullRequest?.url ??
    thread.pullRequests?.filter((pr) => pr.source !== "stack-dismissed").at(-1)?.url ??
    null;
  return url?.startsWith("https://") ? url : null;
}

/** The body of `POST /v1/t3/threads`. `summary` is added when the phase needs one. */
export type StatusReport = {
  environmentId: string;
  threadId: string;
  project: { name: string; title: string };
  title: string;
  phase: Phase;
  branch: string | null;
  pullRequestUrl: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  stopRequested: boolean;
  lastVisitedAt: string | null;
  summary: string | null;
  errorClass: ErrorClass | null;
  /** The T3 stream sequence the report reflects; the server ignores older ones. */
  sequence: number;
  /** The thread was archived or deleted in T3. */
  removed: boolean;
};

const ERROR_CLASSES = [
  "usage_limit",
  "provider_error",
  "transport_error",
  "permission_error",
  "validation_error",
  "unknown",
] as const;
type ErrorClass = (typeof ERROR_CLASSES)[number];

/** T3's failure class, or `unknown` for one this bridge does not know. */
function errorClassOf(value: string | null | undefined): ErrorClass {
  return ERROR_CLASSES.find((known) => known === value) ?? "unknown";
}

const TITLE_LENGTH = 200;
const PROJECT_TITLE_LENGTH = 80;

export function reportFor(
  environmentId: string,
  thread: ThreadShell,
  project: ProjectShell,
  sequence: number,
): StatusReport {
  const phase = phaseOf(thread);
  return {
    environmentId,
    threadId: thread.id,
    project: {
      name: projectName(project),
      title: project.title.slice(0, PROJECT_TITLE_LENGTH) || projectName(project),
    },
    title: thread.title.trim().slice(0, TITLE_LENGTH) || "Untitled thread",
    phase,
    branch: thread.branch ?? null,
    pullRequestUrl: pullRequestUrl(thread),
    runStartedAt: thread.latestRunStartedAt ?? null,
    runCompletedAt: thread.latestRunCompletedAt ?? null,
    stopRequested: thread.latestRunStopRequested === true,
    lastVisitedAt: thread.lastVisitedAt ?? null,
    summary: phase === "failed" ? (thread.lastError ?? null) : null,
    errorClass: phase === "failed" ? errorClassOf(thread.lastErrorClass) : null,
    sequence,
    removed: false,
  };
}

/**
 * What decides whether a report is new. Visits and summaries are left out: a visit alone
 * is no news, and the summary is fetched only after the phase changed.
 */
export function signatureOf(report: StatusReport): string {
  return JSON.stringify([
    report.phase,
    report.title,
    report.project.name,
    report.branch,
    report.pullRequestUrl,
    report.runStartedAt,
    report.runCompletedAt,
    report.removed,
  ]);
}
