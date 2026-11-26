import { describe, expect, it } from "vitest";

import {
  isListedThread,
  phaseOf,
  projectName,
  pullRequestUrl,
  reportFor,
  signatureOf,
  type ThreadShell,
} from "../src/phase.ts";

const thread = (overrides: Partial<ThreadShell> = {}): ThreadShell => ({
  id: "352b089c-3d43-4d8d-850b-47ea9c7a3699",
  projectId: "p1",
  title: "Fix realtime stall",
  status: "running",
  pendingRuntimeRequest: null,
  ...overrides,
});

describe("phaseOf", () => {
  it("puts a pending question or approval before the run status", () => {
    expect(phaseOf(thread({ pendingRuntimeRequest: { kind: "user_input" } }))).toBe(
      "waiting_for_input",
    );
    expect(phaseOf(thread({ pendingRuntimeRequest: { kind: "command" } }))).toBe(
      "waiting_for_approval",
    );
    // A token refresh is T3's own business, not the user's.
    expect(phaseOf(thread({ pendingRuntimeRequest: { kind: "auth_refresh" } }))).toBe("running");
  });

  it("maps run statuses like T3's notifications do", () => {
    expect(phaseOf(thread({ status: "preparing" }))).toBe("starting");
    expect(phaseOf(thread({ status: "completed", activityRunStatus: "waiting" }))).toBe("running");
    expect(phaseOf(thread({ status: "completed" }))).toBe("completed");
    expect(phaseOf(thread({ status: "failed" }))).toBe("failed");
    for (const status of ["idle", "queued", "interrupted", "cancelled", "rolled_back"]) {
      expect(phaseOf(thread({ status }))).toBe("idle");
    }
  });

  it("keeps a run going while the agent waits for its subagents", () => {
    expect(
      phaseOf(thread({ status: "completed", pendingBackgroundTasks: [{ kind: "subagent" }] })),
    ).toBe("running");
    expect(
      phaseOf(thread({ status: "completed", pendingBackgroundTasks: [{ kind: "command" }] })),
    ).toBe("completed");
  });
});

describe("isListedThread", () => {
  it("skips subagents, side chats, archived and deleted threads", () => {
    expect(isListedThread(thread())).toBe(true);
    expect(isListedThread(thread({ lineage: { relationshipToParent: "fork" } }))).toBe(true);
    expect(isListedThread(thread({ lineage: { relationshipToParent: "subagent" } }))).toBe(false);
    expect(isListedThread(thread({ lineage: { sideChat: true } }))).toBe(false);
    expect(isListedThread(thread({ archivedAt: "2026-11-01T00:00:00.000Z" }))).toBe(false);
    expect(isListedThread(thread({ deletedAt: "2026-11-01T00:00:00.000Z" }))).toBe(false);
  });
});

describe("projectName", () => {
  it("uses the workspace folder, as agents name projects after the repo", () => {
    expect(
      projectName({ id: "p", title: "Notifier", workspaceRoot: "/Users/me/code/notifier" }),
    ).toBe("notifier");
    expect(projectName({ id: "p", title: "x", workspaceRoot: "/Users/me/Çok Hızlı App/" })).toBe(
      "cok-hizli-app",
    );
    expect(projectName({ id: "p", title: "My App", workspaceRoot: "/" })).toBe("my-app");
  });
});

describe("reportFor", () => {
  const project = { id: "p1", title: "RezMe", workspaceRoot: "/code/rezme" };

  it("carries the error only for failures, and the newest https pull request", () => {
    const failed = reportFor(
      "env-1",
      thread({
        status: "failed",
        lastError: "Claude API unknown.",
        lastErrorClass: "transport_error",
        pullRequests: [
          { url: "https://github.com/a/b/pull/1", source: "created" },
          { url: "https://github.com/a/b/pull/2", source: "stack-dismissed" },
        ],
      }),
      project,
      7,
    );
    expect(failed).toMatchObject({
      environmentId: "env-1",
      project: { name: "rezme", title: "RezMe" },
      phase: "failed",
      summary: "Claude API unknown.",
      errorClass: "transport_error",
      pullRequestUrl: "https://github.com/a/b/pull/1",
      sequence: 7,
      removed: false,
    });
    // A failure class the bridge does not know is sent as unknown.
    expect(
      reportFor("env-1", thread({ status: "failed", lastErrorClass: "TOKEN=abc" }), project, 7)
        .errorClass,
    ).toBe("unknown");
    expect(reportFor("env-1", thread({ lastError: "old" }), project, 7).summary).toBeNull();
    expect(pullRequestUrl(thread({ linkedPullRequest: { url: "git@github.com:a/b" } }))).toBeNull();
  });

  it("changes its signature on news, not on visits", () => {
    const base = reportFor("env-1", thread(), project, 7);
    const visited = reportFor(
      "env-1",
      thread({ lastVisitedAt: "2026-11-26T10:00:00.000Z" }),
      project,
      7,
    );
    const done = reportFor("env-1", thread({ status: "completed" }), project, 7);
    expect(signatureOf(visited)).toBe(signatureOf(base));
    expect(signatureOf(done)).not.toBe(signatureOf(base));
  });
});
