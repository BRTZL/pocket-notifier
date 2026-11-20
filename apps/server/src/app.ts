import type { Context as ApiContext } from "@notifier/api/context";
import type { Dispatch } from "@notifier/api/dispatch";
import { createPublicHandler } from "@notifier/api/public/handler";
import { appRouter } from "@notifier/api/router";
import { API_PREFIX, AUTH_PATH, MCP_PATH } from "@notifier/auth/paths";
import type { Database } from "@notifier/db";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { RequestLogger } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";

import { isPublicApiPath, isPublicPath } from "./boundary";
import { type OAuthPageDeps, registerOAuthPages } from "./oauth/routes";

export type AppDeps = {
  /** The deployment's public origin; the only origin allowed credentialed CORS. */
  appOrigin: string;
  /** Adds the signed-in user to the request log. Never called for the public API. */
  identifyUser: (log: RequestLogger, headers: Headers, path: string) => Promise<unknown>;
  authHandler: (request: Request) => Promise<Response>;
  getDb: () => Database;
  /** Post-request side effects (push fan-out) for one request. */
  createDispatch: (c: HonoContext<EvlogVariables>, db: Database) => Promise<Dispatch>;
  createContext: (c: HonoContext<EvlogVariables>) => Promise<ApiContext>;
  /** The OAuth sign-in and consent pages for MCP clients. */
  oauthPages: OAuthPageDeps;
  /** Serves `/api/mcp`: verifies the OAuth bearer token, then runs the MCP server. */
  mcp: (c: HonoContext<EvlogVariables>) => Promise<Response>;
};

const METHODS = ["GET", "POST", "OPTIONS"];
const HEADERS = ["Content-Type", "Authorization"];
/** MCP clients (also browser-based ones) send and read these on `/api/mcp`. */
const PUBLIC_METHODS = ["GET", "POST", "DELETE", "OPTIONS"];
const PUBLIC_HEADERS = [...HEADERS, "Mcp-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"];
const PUBLIC_EXPOSED = ["WWW-Authenticate", "Mcp-Session-Id", "Mcp-Protocol-Version"];

/**
 * The server's Hono app. Everything is served under `/api` (see `@notifier/auth/paths`),
 * except the OAuth discovery documents at the root `/.well-known/`, so the deployment's
 * root can serve the docs site. Dependencies are injected so the routing can be tested.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<EvlogVariables>();

  app.use(evlog());
  app.use("*", async (c, next) => {
    // Public paths ignore cookies, so they never look up a session, even to log it.
    if (!isPublicPath(c.req.path)) {
      await deps.identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
    }
    await next();
  });

  // Public: bearer tokens only, so any origin may call it and nothing is credentialed.
  const publicCors = cors({
    origin: "*",
    allowMethods: PUBLIC_METHODS,
    allowHeaders: PUBLIC_HEADERS,
    exposeHeaders: PUBLIC_EXPOSED,
  });
  const appCors = cors({
    origin: deps.appOrigin,
    allowMethods: METHODS,
    allowHeaders: HEADERS,
    credentials: true,
  });
  app.use("*", (c, next) => (isPublicPath(c.req.path) ? publicCors(c, next) : appCors(c, next)));

  app.on(["POST", "GET"], `${AUTH_PATH}/*`, (c) => deps.authHandler(c.req.raw));
  // OAuth discovery for MCP clients: authorization-server metadata at
  // /.well-known/oauth-authorization-server/api/auth (RFC 8414 path insertion) and
  // protected-resource metadata at /.well-known/oauth-protected-resource/api/mcp (RFC 9728).
  app.get("/.well-known/*", (c) => deps.authHandler(c.req.raw));
  registerOAuthPages(app, deps.oauthPages);
  app.on(["GET", "POST", "DELETE"], MCP_PATH, (c) => deps.mcp(c));

  const publicHandler = createPublicHandler();
  app.use("*", async (c, next) => {
    if (!isPublicApiPath(c.req.path)) {
      return next();
    }
    const db = deps.getDb();
    const result = await publicHandler.handle(c.req.raw, {
      prefix: API_PREFIX,
      context: {
        db,
        authorization: c.req.header("Authorization") ?? null,
        dispatch: await deps.createDispatch(c, db),
      },
    });
    if (result.matched) {
      return c.newResponse(result.response.body, result.response);
    }
    // Unmatched public paths fall through to the 404 without touching the session.
    return c.notFound();
  });

  const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });
  app.use("*", async (c, next) => {
    const rpcResult = await rpcHandler.handle(c.req.raw, {
      prefix: `${API_PREFIX}/rpc`,
      context: await deps.createContext(c),
    });
    if (rpcResult.matched) {
      return c.newResponse(rpcResult.response.body, rpcResult.response);
    }
    await next();
  });

  app.get(`${API_PREFIX}/health`, (c) => c.text("OK"));

  return app;
}
