/**
 * A client for the local T3 Code server: its live shell stream over WebSocket, and the
 * thread transcript over HTTP. T3 speaks Effect RPC with JSON serialization; the few
 * frames the bridge needs are written by hand, so the bridge has no dependencies.
 *
 * Frames (effect/rpc, Effect 4):
 * - out: `{_tag:"Request", id, tag, payload, headers:[]}`, `{_tag:"Ack", requestId}` after
 *   every Chunk (the server waits for it before the next one), `{_tag:"Ping"}`.
 * - in: `{_tag:"Chunk", requestId, values}`, `{_tag:"Exit", requestId, exit}`, `Pong`,
 *   `Defect`, `ClientProtocolError`. A frame may hold one message or an array of them.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ProjectShell, ThreadShell } from "./phase.ts";

export const T3_HOME = process.env.T3CODE_HOME ?? join(homedir(), ".t3");
const USERDATA = join(T3_HOME, "userdata");
const PING_MS = 5000;
const REQUEST_ID = "1";
const HTTP_SCHEME = /^http/u;

export type ShellItem =
  | {
      kind: "snapshot";
      snapshot: { snapshotSequence: number; projects: ProjectShell[]; threads: ThreadShell[] };
    }
  | { kind: "thread.updated"; sequence: number; thread: ThreadShell }
  | { kind: "thread.removed"; sequence: number; threadId: string }
  | { kind: "project.updated"; sequence: number; project: ProjectShell }
  | { kind: "project.removed"; sequence: number; projectId: string }
  | { kind: "synchronized" };

/** Where the local T3 server listens: `server-runtime.json`, rewritten on every start. */
export async function readServerOrigin(): Promise<string> {
  const runtime = JSON.parse(await readFile(join(USERDATA, "server-runtime.json"), "utf8")) as {
    origin?: string;
  };
  if (!runtime.origin) {
    throw new Error("T3 Code's server-runtime.json has no origin: is T3 Code running?");
  }
  return runtime.origin;
}

export async function readEnvironmentId(): Promise<string> {
  return (await readFile(join(USERDATA, "environment-id"), "utf8")).trim();
}

/** Thrown when T3 refuses the token, so the bridge can issue a new one. */
export class T3AuthError extends Error {}

/** Thrown when T3 refuses the protocol version: the bridge needs an update. */
export class T3ProtocolError extends Error {}

/**
 * Subscribes to the shell stream and calls `onItems` with each chunk's items, in order.
 * `onItems` finishes before the chunk is acknowledged, so a slow consumer slows the
 * server down instead of losing items. Resolves when the stream or socket ends.
 */
export function subscribeShell(args: {
  origin: string;
  token: string;
  afterSequence: number | null;
  onItems: (items: ShellItem[]) => Promise<void>;
  onOpen?: () => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${args.origin.replace(HTTP_SCHEME, "ws")}/ws?orchestrationProtocol=2`;
    // Node's WebSocket (undici) takes headers; the browser type does not know them.
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${args.token}` },
    } as unknown as string[]);
    let pinger: ReturnType<typeof setInterval> | undefined;
    let queue = Promise.resolve();
    let settled = false;
    const send = (frame: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(frame));
      }
    };
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(pinger);
      try {
        ws.close(1000);
      } catch {
        // Already closed.
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    ws.addEventListener("open", () => {
      args.onOpen?.();
      send({
        _tag: "Request",
        id: REQUEST_ID,
        tag: "orchestration.subscribeShell",
        payload: {
          requestCompletionMarker: true,
          ...(args.afterSequence === null ? {} : { afterSequence: args.afterSequence }),
        },
        headers: [],
      });
      pinger = setInterval(() => send({ _tag: "Ping" }), PING_MS);
    });
    ws.addEventListener("error", (event) => {
      const message = (event as unknown as { message?: string }).message ?? "WebSocket error";
      if (message.includes("401") || message.includes("403")) {
        finish(new T3AuthError(message));
      } else if (message.includes("426")) {
        finish(new T3ProtocolError(message));
      } else {
        finish(new Error(message));
      }
    });
    // Items already received are handled before the stream counts as ended.
    ws.addEventListener("close", () => {
      queue.then(() => finish());
    });
    const handleFrame = (frame: Frame) => {
      switch (frame._tag) {
        case "Chunk": {
          const values = frame.values ?? [];
          queue = queue
            // After a failure nothing more is handled: the next connection resumes from
            // the last item that was.
            .then(() => (settled ? undefined : args.onItems(values)))
            .then(() => send({ _tag: "Ack", requestId: frame.requestId }))
            .catch((error: unknown) =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
          break;
        }
        case "Exit": {
          const failure = frame.exit?._tag === "Failure" ? JSON.stringify(frame.exit.cause) : "";
          const error = failure
            ? new Error(`T3 ended the stream: ${failure.slice(0, 300)}`)
            : undefined;
          queue.then(() => finish(error));
          break;
        }
        case "Defect":
        case "ClientProtocolError":
          finish(new Error(`T3 ${frame._tag}: ${JSON.stringify(frame).slice(0, 300)}`));
          break;
        default:
          // Pong and frames this bridge does not use.
          break;
      }
    };
    ws.addEventListener("message", (event) => {
      for (const frame of framesOf(event.data)) {
        handleFrame(frame);
      }
    });
  });
}

type Frame = {
  _tag: string;
  requestId?: string;
  values?: ShellItem[];
  exit?: { _tag: string; cause?: unknown };
};

/** A WebSocket message holds one frame or an array of them. */
function framesOf(data: unknown): Frame[] {
  const text = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString();
  const parsed = JSON.parse(text) as Frame | Frame[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

type TranscriptItem = { item?: { type?: string; text?: string } };

/** The last thing the agent said in the thread, or `null`. */
export async function lastAssistantText(args: {
  origin: string;
  token: string;
  threadId: string;
}): Promise<string | null> {
  const response = await fetch(
    `${args.origin}/api/orchestration/threads/${encodeURIComponent(args.threadId)}/transcript`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        "x-t3-orchestration-protocol": "2",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new T3AuthError(`transcript: HTTP ${response.status}`);
  }
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { items?: TranscriptItem[] };
  const last = (body.items ?? [])
    .filter((entry) => entry.item?.type === "assistant_message")
    .at(-1);
  return last?.item?.text ?? null;
}
