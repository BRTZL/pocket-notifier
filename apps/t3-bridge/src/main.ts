/**
 * T3 bridge: follows the local T3 Code server's threads and reports their status to
 * Pocket Notifier, which shows them on the phone and pushes only what the user would
 * otherwise miss (see packages/api/src/lib/t3-status.ts).
 *
 * Config (environment, or the file in $T3_BRIDGE_ENV, default
 * ~/.config/pocket-notifier/t3-bridge.env):
 * - NOTIFIER_TOKEN: a Pocket Notifier access token (Settings → Tokens), scope "all".
 * - NOTIFIER_API_URL: default https://notifier.bartuozel.com/api.
 * - T3_CLI: the `t3` command, default ~/.t3/bin/t3. The bridge issues itself a read-only
 *   T3 token with it (`t3 auth session issue --scope orchestration:read`).
 *
 * State (last stream position, what was reported, the T3 token) lives in
 * ~/.local/state/pocket-notifier/t3-bridge/, readable by the user only.
 */
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import {
  isListedThread,
  type ProjectShell,
  reportFor,
  type StatusReport,
  signatureOf,
  type ThreadShell,
} from "./phase.ts";
import {
  lastAssistantText,
  readEnvironmentId,
  readServerOrigin,
  type ShellItem,
  subscribeShell,
  T3_HOME,
  T3AuthError,
  T3ProtocolError,
} from "./t3-client.ts";

const run = promisify(execFile);

const CONFIG_FILE =
  process.env.T3_BRIDGE_ENV ?? join(homedir(), ".config", "pocket-notifier", "t3-bridge.env");
const STATE_DIR =
  process.env.T3_BRIDGE_STATE_DIR ??
  join(homedir(), ".local", "state", "pocket-notifier", "t3-bridge");
const STATE_FILE = join(STATE_DIR, "state.json");
const TOKEN_FILE = join(STATE_DIR, "t3-token.json");

/** On the first run, threads quiet for longer than this are recorded without a report. */
const FIRST_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60_000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
/** A new T3 token this long before the old one expires. */
const TOKEN_RENEW_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL = "30d";
const SUMMARY_LENGTH = 500;

type State = {
  /** Highest shell sequence handled; the stream resumes after it. */
  sequence: number | null;
  /** Per thread: the signature of the last report the server accepted. */
  reported: Record<string, string>;
};

type Config = { apiUrl: string; notifierToken: string; t3Cli: string };

const ENV_LINE = /^\s*(?<key>[A-Z0-9_]+)\s*=\s*(?<value>.*?)\s*$/u;
const QUOTES = /^["']|["']$/gu;
const TRAILING_SLASH = /\/$/u;

/** `record` without `key`. */
function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function readConfig(): Promise<Config> {
  const values: Record<string, string> = {};
  try {
    for (const line of (await readFile(CONFIG_FILE, "utf8")).split("\n")) {
      const match = ENV_LINE.exec(line);
      if (match?.groups?.key && match.groups.value !== undefined) {
        values[match.groups.key] = match.groups.value.replace(QUOTES, "");
      }
    }
  } catch {
    // No file: the environment must carry the config.
  }
  const get = (key: string) => process.env[key] ?? values[key];
  const notifierToken = get("NOTIFIER_TOKEN");
  if (!notifierToken) {
    throw new Error(`NOTIFIER_TOKEN is missing: set it in ${CONFIG_FILE}`);
  }
  return {
    apiUrl: (get("NOTIFIER_API_URL") ?? "https://notifier.bartuozel.com/api").replace(
      TRAILING_SLASH,
      "",
    ),
    notifierToken,
    t3Cli: get("T3_CLI") ?? join(T3_HOME, "bin", "t3"),
  };
}

async function writePrivate(path: string, content: string) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
  } catch {
    return { sequence: null, reported: {} };
  }
}

/** A read-only T3 token, issued with the `t3` CLI and kept until a day before it expires. */
class T3Token {
  private cached: { token: string; expiresAt: string } | null = null;
  private readonly cli: string;

  constructor(cli: string) {
    this.cli = cli;
  }

  async get(): Promise<string> {
    if (!this.cached) {
      try {
        this.cached = JSON.parse(await readFile(TOKEN_FILE, "utf8"));
      } catch {
        this.cached = null;
      }
    }
    if (this.cached && Date.parse(this.cached.expiresAt) - Date.now() > TOKEN_RENEW_MS) {
      return this.cached.token;
    }
    return await this.issue();
  }

  async issue(): Promise<string> {
    const { stdout } = await run(this.cli, [
      "auth",
      "session",
      "issue",
      "--scope",
      "orchestration:read",
      "--ttl",
      TOKEN_TTL,
      "--label",
      "pocket-notifier-t3-bridge",
      "--json",
    ]);
    const issued = JSON.parse(stdout) as { token?: string; expiresAt?: string };
    if (!(issued.token && issued.expiresAt)) {
      throw new Error("t3 auth session issue returned no token");
    }
    this.cached = { token: issued.token, expiresAt: issued.expiresAt };
    await writePrivate(TOKEN_FILE, JSON.stringify(this.cached));
    log(`issued a read-only T3 token, valid until ${issued.expiresAt}`);
    return issued.token;
  }
}

class Notifier {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return await fetch(`${this.config.apiUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.notifierToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  }

  /** `true` when the server took the report; `false` when it refused it for good. */
  async report(report: StatusReport): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: retries wait on the previous attempt.
        const response = await this.post("/v1/t3/threads", report);
        if (response.ok) {
          const result = (await response.json()) as { feature: string; pushed: boolean };
          log(
            `${report.phase.padEnd(20)} ${report.project.name}/${result.feature}${result.pushed ? " (pushed)" : ""}`,
          );
          return true;
        }
        if (response.status < 500 && response.status !== 429) {
          log(
            `server refused ${report.threadId}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
          );
          return false;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt >= 5) {
          throw error;
        }
        await sleep(2 ** attempt * 1000);
      }
    }
  }

  async heartbeat(environmentId: string) {
    try {
      const response = await this.post("/v1/t3/heartbeat", { environmentId });
      if (!response.ok) {
        log(`heartbeat: HTTP ${response.status}`);
      }
    } catch (error) {
      log(`heartbeat failed: ${(error as Error).message}`);
    }
  }
}

class Bridge {
  private readonly projects = new Map<string, ProjectShell>();
  private state: State = { sequence: null, reported: {} };
  private origin = "";
  private readonly environmentId: string;
  private readonly token: T3Token;
  private readonly notifier: Notifier;

  constructor(args: { environmentId: string; token: T3Token; notifier: Notifier }) {
    this.environmentId = args.environmentId;
    this.token = args.token;
    this.notifier = args.notifier;
  }

  async start() {
    this.state = await loadState();
    setInterval(() => void this.notifier.heartbeat(this.environmentId), HEARTBEAT_MS).unref();
    await this.notifier.heartbeat(this.environmentId);
    let delay = RECONNECT_MIN_MS;
    while (true) {
      let opened = false;
      try {
        // A restarted T3 server may listen on another port.
        // biome-ignore lint/performance/noAwaitInLoops: one connection at a time.
        this.origin = await readServerOrigin();
        const token = await this.token.get();
        await subscribeShell({
          origin: this.origin,
          token,
          afterSequence: this.state.sequence,
          onOpen: () => {
            opened = true;
            delay = RECONNECT_MIN_MS;
            log(`connected to T3 at ${this.origin}`);
          },
          onItems: (items) => this.handle(items),
        });
        log("T3 stream ended");
      } catch (error) {
        if (error instanceof T3ProtocolError) {
          log(`T3 refused the protocol (${error.message}): update the bridge`);
        } else if (error instanceof T3AuthError || (!opened && (await this.tokenRefused()))) {
          log("T3 refused the token; issuing a new one");
          await this.token
            .issue()
            .catch((issueError: Error) => log(`t3 auth failed: ${issueError.message}`));
        } else {
          log(`T3 connection failed: ${(error as Error).message}`);
        }
      }
      await sleep(delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }
  }

  /** Whether T3 answers but refuses the current token. */
  private async tokenRefused(): Promise<boolean> {
    try {
      const response = await fetch(`${this.origin}/api/projects`, {
        headers: {
          Authorization: `Bearer ${await this.token.get()}`,
          "x-t3-orchestration-protocol": "2",
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.status === 401 || response.status === 403;
    } catch {
      return false;
    }
  }

  private async handle(items: ShellItem[]) {
    for (const item of items) {
      switch (item.kind) {
        case "snapshot": {
          const { snapshot } = item;
          for (const project of snapshot.projects) {
            this.projects.set(project.id, project);
          }
          // A project-only snapshot (no threads) refreshes metadata; it removes nothing.
          const firstRun = this.state.sequence === null;
          for (const thread of snapshot.threads) {
            // biome-ignore lint/performance/noAwaitInLoops: reports go out in stream order.
            await this.consider(thread, { quietIfOld: firstRun });
          }
          this.advance(snapshot.snapshotSequence);
          break;
        }
        case "project.updated":
          this.projects.set(item.project.id, item.project);
          this.advance(item.sequence);
          break;
        case "thread.updated":
          await this.consider(item.thread, { quietIfOld: false });
          this.advance(item.sequence);
          break;
        case "thread.removed":
          this.state.reported = withoutKey(this.state.reported, item.threadId);
          this.advance(item.sequence);
          break;
        case "project.removed":
          this.projects.delete(item.projectId);
          this.advance(item.sequence);
          break;
        default:
          break;
      }
    }
    await writePrivate(STATE_FILE, JSON.stringify(this.state));
  }

  private advance(sequence: number) {
    this.state.sequence = Math.max(this.state.sequence ?? 0, sequence);
  }

  private async consider(thread: ThreadShell, options: { quietIfOld: boolean }) {
    if (!isListedThread(thread)) {
      return;
    }
    const project = this.projects.get(thread.projectId);
    if (!project) {
      return;
    }
    const report = reportFor(this.environmentId, thread, project);
    const signature = signatureOf(report);
    if (this.state.reported[thread.id] === signature) {
      return;
    }
    const updatedAt = thread.updatedAt ? Date.parse(thread.updatedAt) : 0;
    if (options.quietIfOld && Date.now() - updatedAt > FIRST_RUN_WINDOW_MS) {
      // First run: remember old threads without reporting them.
      this.state.reported[thread.id] = signature;
      return;
    }
    if (report.phase === "completed") {
      report.summary = await this.summaryOf(thread.id);
    }
    if (report.summary) {
      report.summary = report.summary.slice(0, SUMMARY_LENGTH);
    }
    if (await this.notifier.report(report)) {
      this.state.reported[thread.id] = signature;
    }
  }

  private async summaryOf(threadId: string): Promise<string | null> {
    try {
      return await lastAssistantText({
        origin: this.origin,
        token: await this.token.get(),
        threadId,
      });
    } catch (error) {
      log(`transcript of ${threadId} failed: ${(error as Error).message}`);
      return null;
    }
  }
}

async function main() {
  const config = await readConfig();
  const bridge = new Bridge({
    environmentId: await readEnvironmentId(),
    token: new T3Token(config.t3Cli),
    notifier: new Notifier(config),
  });
  log(`T3 bridge starting; reporting to ${config.apiUrl}`);
  await bridge.start();
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
