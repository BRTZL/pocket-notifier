import { initLogger } from "evlog";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";

import { createApp } from "./app";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { createScheduledHandler } from "./scheduled";
import { createAuth, getDb, oauthPageDeps, requestDispatch, serveMcp } from "./services";

initLogger({
  env: { service: "notifier-server" },
});

// Built inside the request, not at module load: the OAuth provider plugin seeds its
// resource row on init, and Workers forbid I/O in the global scope.
const identifyUser: Parameters<typeof createApp>[0]["identifyUser"] = async (log, headers, path) =>
  createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
    exclude: ["/api/auth/**"],
    maskEmail: true,
  })(log, headers, path);

const app = createApp({
  appOrigin: ENV.CORS_ORIGIN,
  identifyUser,
  authHandler: async (request) => (await createAuth()).handler(request),
  getDb,
  createDispatch: requestDispatch,
  createContext: (c) => createContext({ context: c }),
  oauthPages: oauthPageDeps(),
  mcp: serveMcp,
});

const scheduled = createScheduledHandler({ getDb });

export default {
  fetch: app.fetch,
  // Hourly Cron Trigger (wrangler.jsonc locally, alchemy.run.ts on deploy): retention cleanup.
  scheduled: (controller, _env, ctx) => scheduled(controller, ctx),
} satisfies ExportedHandler<Env>;
