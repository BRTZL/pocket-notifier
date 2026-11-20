import { initLogger } from "evlog";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";

import { createApp } from "./app";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { createAuth, getDb, requestDispatch } from "./services";

initLogger({
  env: { service: "notifier-server" },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = createApp({
  appOrigin: ENV.CORS_ORIGIN,
  identifyUser,
  authHandler: async (request) => (await createAuth()).handler(request),
  getDb,
  createDispatch: requestDispatch,
  createContext: (c) => createContext({ context: c }),
});

export default app;
