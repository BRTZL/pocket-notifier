import type { Context as ApiContext } from "@notifier/api/context";
import { createPublicHandler } from "@notifier/api/public/handler";
import { appRouter } from "@notifier/api/router";
import type { Database } from "@notifier/db";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { RequestLogger } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";

import { isPublicApiPath } from "./boundary";
import { createDispatch } from "./dispatch";

export type AppDeps = {
  /** Origin of the web app; the only origin allowed credentialed CORS. */
  appOrigin: string;
  /** Adds the signed-in user to the request log. Never called for the public API. */
  identifyUser: (log: RequestLogger, headers: Headers, path: string) => Promise<unknown>;
  authHandler: (request: Request) => Promise<Response>;
  getDb: () => Database;
  createContext: (c: HonoContext<EvlogVariables>) => Promise<ApiContext>;
};

const METHODS = ["GET", "POST", "OPTIONS"];
const HEADERS = ["Content-Type", "Authorization"];

/** The server's Hono app. Dependencies are injected so the routing can be tested. */
export function createApp(deps: AppDeps) {
  const app = new Hono<EvlogVariables>();

  app.use(evlog());
  app.use("*", async (c, next) => {
    // The public API ignores cookies, so it never looks up a session, even to log it.
    if (!isPublicApiPath(c.req.path)) {
      await deps.identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
    }
    await next();
  });

  // Public: bearer tokens only, so any origin may call it and nothing is credentialed.
  const publicCors = cors({ origin: "*", allowMethods: METHODS, allowHeaders: HEADERS });
  const appCors = cors({
    origin: deps.appOrigin,
    allowMethods: METHODS,
    allowHeaders: HEADERS,
    credentials: true,
  });
  app.use("*", (c, next) => (isPublicApiPath(c.req.path) ? publicCors(c, next) : appCors(c, next)));

  app.on(["POST", "GET"], "/api/auth/*", (c) => deps.authHandler(c.req.raw));

  const publicHandler = createPublicHandler();
  app.use("*", async (c, next) => {
    if (!isPublicApiPath(c.req.path)) {
      return next();
    }
    const result = await publicHandler.handle(c.req.raw, {
      context: {
        db: deps.getDb(),
        authorization: c.req.header("Authorization") ?? null,
        dispatch: createDispatch(c.get("log")),
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
      prefix: "/rpc",
      context: await deps.createContext(c),
    });
    if (rpcResult.matched) {
      return c.newResponse(rpcResult.response.body, rpcResult.response);
    }
    await next();
  });

  app.get("/", (c) => c.text("OK"));

  return app;
}
