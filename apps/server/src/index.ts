import { initLogger } from "evlog";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";

import { createApp } from "./app";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { createScheduledHandler } from "./scheduled";
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

const scheduled = createScheduledHandler({ getDb });

export default {
  fetch: app.fetch,
  // Hourly Cron Trigger (wrangler.jsonc locally, alchemy.run.ts on deploy): retention cleanup.
  scheduled: (controller, _env, ctx) => scheduled(controller, ctx),
} satisfies ExportedHandler<Env>;
