import { createPublicHandler } from "@notifier/api/public/handler";
import { appRouter } from "@notifier/api/router";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { initLogger } from "evlog";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { createDispatch } from "./dispatch";
import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";

initLogger({
  env: { service: "notifier-server" },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(evlog());
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

const PUBLIC_API_PREFIX = "/v1/";

// The public API authenticates with a bearer token, never cookies, so any origin may call it.
app.use(
  "/v1/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

const appCors = cors({
  origin: ENV.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});
app.use("/*", (c, next) => (c.req.path.startsWith(PUBLIC_API_PREFIX) ? next() : appCors(c, next)));

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

const publicHandler = createPublicHandler();

app.use("/v1/*", async (c, next) => {
  const result = await publicHandler.handle(c.req.raw, {
    context: {
      db: getDb(),
      authorization: c.req.header("Authorization") ?? null,
      dispatch: createDispatch(c.get("log")),
    },
  });
  if (result.matched) {
    return c.newResponse(result.response.body, result.response);
  }
  await next();
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  if (c.req.path.startsWith(PUBLIC_API_PREFIX)) {
    return next();
  }
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  await next();
});

app.get("/", (c) => c.text("OK"));

export default app;
