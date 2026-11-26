import type { Message } from "@notifier/contract/message";
import type { T3ThreadStatusInput } from "@notifier/contract/t3";
import { feature, t3Bridge } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { redactSecrets } from "../src/lib/redact";
import { decidePush, LONG_RUN_MS, RECENT_VISIT_MS, summaryLine } from "../src/lib/t3-status";
import { createTestDb, type TestDb } from "./db";
import { clientFor, publicClientFor, seedUser, type TestUser } from "./helpers";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function finished(overrides: Partial<Parameters<typeof decidePush>[0]["input"]> = {}) {
  return {
    phase: "completed" as const,
    stopRequested: false,
    runStartedAt: minutesAgo(12),
    runCompletedAt: minutesAgo(1),
    lastVisitedAt: minutesAgo(60),
    ...overrides,
  };
}

describe("decidePush", () => {
  it("pushes a long run that finished unseen and unannounced", () => {
    expect(
      decidePush({ previous: "running", input: finished(), agentSpoke: false, now: NOW }),
    ).toEqual({ kind: "completed" });
  });

  it("stays quiet when the agent spoke, the run was short, the user watched or stopped it", () => {
    const quiet = [
      { previous: "running" as const, input: finished(), agentSpoke: true },
      {
        previous: "running" as const,
        input: finished({
          runStartedAt: new Date(Date.parse(minutesAgo(1)) - LONG_RUN_MS + 1000).toISOString(),
        }),
        agentSpoke: false,
      },
      {
        previous: "running" as const,
        input: finished({
          lastVisitedAt: new Date(NOW.getTime() - RECENT_VISIT_MS + 1000).toISOString(),
        }),
        agentSpoke: false,
      },
      { previous: "running" as const, input: finished({ stopRequested: true }), agentSpoke: false },
      // First report after the bridge starts, and repeats of the same phase.
      { previous: null, input: finished(), agentSpoke: false },
      { previous: "completed" as const, input: finished(), agentSpoke: false },
    ];
    for (const args of quiet) {
      expect(decidePush({ ...args, now: NOW })).toBeNull();
    }
  });

  it("pushes failures, even after a short run, but not after Stop", () => {
    const failed = finished({ phase: "failed", runStartedAt: minutesAgo(2) });
    expect(decidePush({ previous: "running", input: failed, agentSpoke: true, now: NOW })).toEqual({
      kind: "failed",
    });
    expect(
      decidePush({
        previous: "running",
        input: { ...failed, stopRequested: true },
        agentSpoke: false,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("never pushes for waiting phases: T3's own app asks the user", () => {
    for (const phase of ["waiting_for_approval", "waiting_for_input", "running"] as const) {
      expect(
        decidePush({
          previous: "running",
          input: finished({ phase }),
          agentSpoke: false,
          now: NOW,
        }),
      ).toBeNull();
    }
  });
});

describe("redactSecrets", () => {
  it("masks tokens, keys and credentials but keeps the sentence", () => {
    const text = [
      "pushed with ghp_abcdefghijklmnopqrstuvwxyz0123 and",
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
      "postgres://app:hunter2secret@db.example.com/app",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----",
    ].join(" ");
    const out = redactSecrets(text);
    expect(out).not.toContain("ghp_abcdefghij");
    expect(out).not.toContain("sk-proj");
    expect(out).not.toContain("hunter2secret");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("MIIEvQ");
    expect(out).toContain("OPENAI_API_KEY=[redacted]");
    expect(out).toContain("postgres://app:[redacted]@db.example.com/app");
    expect(out).toContain("pushed with");
  });

  it("leaves ordinary text alone", () => {
    const text = "Fixed the login flow, 42 tests pass. PR #12 is open.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("drops markdown link targets and emphasis from summaries", () => {
    expect(
      summaryLine(
        "## Done\n**Report**: [dashboard.json](/Users/me/x/dashboard.json) and `pnpm test`",
      ),
    ).toBe("Done Report: dashboard.json and pnpm test");
  });

  it("makes summaries one masked line", () => {
    expect(summaryLine("Done.\n\nTOKEN=abcdefghij was set", 30)).toBe(
      "Done. TOKEN=[redacted] was set",
    );
    expect(summaryLine("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("T3 bridge API", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let published: Message[];
  let dispatch: Dispatch;
  let secret: string;

  const status = (overrides: Partial<T3ThreadStatusInput> = {}): T3ThreadStatusInput => ({
    environmentId: "env-1",
    threadId: "352b089c-3d43-4d8d-850b-47ea9c7a3699",
    project: { name: "rezme", title: "RezMe" },
    title: "Fix realtime stall",
    phase: "running",
    branch: "fix/realtime",
    // The API uses the real clock.
    runStartedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    published = [];
    dispatch = {
      messagePublished: vi.fn((message: Message) => {
        published.push(message);
      }),
      messagesRead: vi.fn(),
    };
    ({ secret } = await clientFor(testDb.db, ada).tokens.create({
      name: "bridge",
      scope: { kind: "all" },
    }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("creates the project and feature silently, then pushes the unannounced finish", async () => {
    const api = publicClientFor(testDb.db, secret, dispatch);
    const first = await api.t3.threadStatus(status());
    expect(first).toEqual({ project: "rezme", feature: "fix-realtime-stall", pushed: false });
    expect(published).toHaveLength(0);

    const done = await api.t3.threadStatus(
      status({
        phase: "completed",
        title: "Fix 4-min realtime stall",
        runCompletedAt: new Date().toISOString(),
        summary: "Fixed the stall.\nDEPLOY_TOKEN=abcdefghijkl was used.",
        pullRequestUrl: "https://github.com/acme/app/pull/248",
      }),
    );
    expect(done.pushed).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      project: "rezme",
      title: "Thread finished",
      body: "Fixed the stall. DEPLOY_TOKEN=[redacted] was used.",
      sender: { id: "t3-bridge", name: "T3 Code" },
      conversation: { id: "fix-realtime-stall", title: "Fix 4-min realtime stall" },
      actions: [
        { label: "Open in T3", url: "t3code://threads/env-1/352b089c-3d43-4d8d-850b-47ea9c7a3699" },
        { label: "Open PR", url: "https://github.com/acme/app/pull/248" },
      ],
    });

    const [row] = await testDb.db
      .select()
      .from(feature)
      .where(eq(feature.slug, "fix-realtime-stall"));
    expect(row).toMatchObject({
      name: "Fix 4-min realtime stall",
      t3Phase: "completed",
      t3Branch: "fix/realtime",
      t3Summary: "Fixed the stall. DEPLOY_TOKEN=[redacted] was used.",
    });
  });

  it("stays quiet when the agent already sent a notification during the run", async () => {
    const api = publicClientFor(testDb.db, secret, dispatch);
    await api.t3.threadStatus(status());
    await api.messages.publish({
      project: "rezme",
      title: "Stall fixed",
      conversation: { id: "fix-realtime-stall" },
    });
    const done = await api.t3.threadStatus(
      status({ phase: "completed", runCompletedAt: new Date().toISOString() }),
    );
    expect(done.pushed).toBe(false);
    expect(published).toHaveLength(1);
  });

  it("puts threads waiting on the user first on the board, with the bridge's last heartbeat", async () => {
    const api = publicClientFor(testDb.db, secret, dispatch);
    await api.t3.threadStatus(status({ threadId: "t-running", title: "Running one" }));
    await api.t3.threadStatus(status({ threadId: "t-waiting", title: "Waiting one" }));
    await api.t3.threadStatus(
      status({ threadId: "t-waiting", title: "Waiting one", phase: "waiting_for_input" }),
    );
    await api.t3.heartbeat({ environmentId: "env-1" });

    const board = await clientFor(testDb.db, ada).t3.board();
    expect(board.bridgeSeenAt).not.toBeNull();
    expect(board.threads.map((thread) => [thread.name, thread.t3.phase])).toEqual([
      ["Waiting one", "waiting_for_input"],
      ["Running one", "running"],
    ]);
    expect(board.threads[0]).toMatchObject({
      project: "rezme",
      projectTitle: "RezMe",
      key: "c:waiting-one",
      hasMessages: false,
      t3: { url: "t3code://threads/env-1/t-waiting", branch: "fix/realtime" },
    });
    // Another user sees nothing of it.
    const bob = await seedUser(testDb.db, "bob");
    expect((await clientFor(testDb.db, bob).t3.board()).threads).toEqual([]);
  });

  it("refuses a token scoped to other projects, and records heartbeats", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.projects.create({ name: "other" });
    const scoped = await owner.tokens.create({
      name: "scoped",
      scope: { kind: "projects", projects: ["other"] },
    });
    await expect(
      publicClientFor(testDb.db, scoped.secret, dispatch).t3.threadStatus(status()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await publicClientFor(testDb.db, secret).t3.heartbeat({ environmentId: "env-1" });
    const [beat] = await testDb.db.select().from(t3Bridge);
    expect(beat).toMatchObject({ userId: ada.id, environmentId: "env-1" });
  });
});
