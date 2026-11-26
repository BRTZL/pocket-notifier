/**
 * Serves the notifier MCP server over Streamable HTTP for one verified request.
 * Stateless: a fresh handler and server per request (a single JSON or one-event SSE answer),
 * and GET/DELETE (session operations) answered with 405 by the SDK.
 *
 * Token verification happens before this runs (`requireMcpAuth` in `apps/server`); this
 * takes the verified access-token claims.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  T3_ENVIRONMENT_HEADER,
  T3_THREAD_HEADER,
  T3Id,
  type T3ThreadHint,
} from "@notifier/contract/t3";
import type { Database } from "@notifier/db";
import { oauthClient } from "@notifier/db/schema/oauth";
import { eq } from "drizzle-orm";

import type { Dispatch } from "../dispatch";
import type { Files } from "../lib/files";
import { createNotifierMcpServer } from "./server";

/** `Sender.name` allows at most 40 characters. */
const SENDER_NAME_LENGTH = 40;
/** Used when a token carries no client id; never expected from the OAuth provider. */
const FALLBACK_SENDER = "agent";

export type McpTokenClaims = {
  /** The user id. */
  sub?: string;
  /** The OAuth client id. */
  azp?: unknown;
  client_id?: unknown;
};

/** A registered OAuth client with its `client_name` (e.g. "Claude Code"), or `null`. */
export async function findOAuthClient(
  db: Database,
  clientId: string,
): Promise<{ name: string | null } | null> {
  const [row] = await db
    .select({ name: oauthClient.name })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  return row ? { name: row.name?.trim() || null } : null;
}

/** The client's name cut to what `Sender.name` allows. */
async function findOAuthClientName(db: Database, clientId: string): Promise<string | undefined> {
  const name = (await findOAuthClient(db, clientId))?.name;
  return name ? name.slice(0, SENDER_NAME_LENGTH) : undefined;
}

/**
 * The T3 thread an MCP client runs in, from the headers its config sets from the agent's
 * environment (`X-T3-Thread-Id: ${T3CODE_THREAD_ID}`). Ids that are not T3 ids are
 * ignored, and so is an empty header: a client outside T3 expands the variable to "".
 */
export function t3ThreadOf(request: Request): T3ThreadHint | null {
  const thread = T3Id.safeParse(request.headers.get(T3_THREAD_HEADER) ?? "");
  if (!thread.success) {
    return null;
  }
  const environment = T3Id.safeParse(request.headers.get(T3_ENVIRONMENT_HEADER) ?? "");
  return environment.success
    ? { threadId: thread.data, environmentId: environment.data }
    : { threadId: thread.data };
}

export type McpRequestDeps = {
  db: Database;
  dispatch: Dispatch;
  files: Files;
};

/** Answers one `/mcp` request for the user and client named by `claims`. */
export async function handleMcpRequest(
  request: Request,
  claims: McpTokenClaims,
  deps: McpRequestDeps,
): Promise<Response> {
  const userId = claims.sub;
  if (!userId) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32_001, message: "Token has no subject" }, id: null },
      { status: 401 },
    );
  }
  const rawClientId = typeof claims.azp === "string" ? claims.azp : claims.client_id;
  const clientId = typeof rawClientId === "string" && rawClientId ? rawClientId : null;
  const sender = clientId
    ? { id: clientId, name: await findOAuthClientName(deps.db, clientId) }
    : { id: FALLBACK_SENDER };

  const handler = createMcpHandler(
    () =>
      createNotifierMcpServer({
        db: deps.db,
        userId,
        sender,
        t3Thread: t3ThreadOf(request),
        dispatch: deps.dispatch,
        files: deps.files,
      }),
    {
      keepAliveMs: 0,
      maxRequestBodySize: 64 * 1024,
      onerror: (error) => {
        console.error("mcp request failed", error.message);
      },
    },
  );
  try {
    return await handler.fetch(request);
  } finally {
    await handler.close();
  }
}
