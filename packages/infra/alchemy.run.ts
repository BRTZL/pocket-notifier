import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import "varlock/auto-load";

/**
 * One hostname serves everything: the docs site at the root, the server Worker under
 * `/api`, plus the OAuth discovery documents at the root `/.well-known/` (RFC 8414 and
 * RFC 9728 put them there, outside `/api`). The zone must already be in the account.
 */
const DOMAIN = process.env.NOTIFIER_DOMAIN ?? "notifier.bartuozel.com";
const ZONE = process.env.NOTIFIER_ZONE ?? "bartuozel.com";
const ORIGIN = `https://${DOMAIN}`;

/**
 * A secret that may be unset. It resolves to `undefined` when absent, and Alchemy leaves
 * `undefined` env values out of the Worker, so the binding simply does not exist.
 *
 * Typed as a plain `Redacted` because `InferEnv` recurses too deeply on
 * `Redacted | undefined`; the server reads these values as possibly missing.
 */
function optionalSecret(name: string) {
  return Config.Redacted(name).pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ) as unknown as Config.Config<Redacted.Redacted<string>>;
}

export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
});

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  // Routes run in front of the docs site's custom domain, so these paths reach the server.
  routes: [
    { pattern: `${DOMAIN}/api/*`, zoneName: ZONE },
    { pattern: `${DOMAIN}/.well-known/*`, zoneName: ZONE },
  ],
  // Only reachable on the deployment's own origin: the OAuth issuer and the MCP resource
  // are URLs on it, and the session cookie belongs to it.
  workersDev: false,
  env: {
    DB: db,
    CORS_ORIGIN: Config.String("CORS_ORIGIN").pipe(Config.withDefault(ORIGIN)),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    // The origin, without `/api`: better-auth adds its `/api/auth` basePath itself.
    BETTER_AUTH_URL: ORIGIN,
    // Optional: when unset the binding is left out and the server runs with push disabled.
    FCM_SERVICE_ACCOUNT: optionalSecret("FCM_SERVICE_ACCOUNT"),
  },
  // Hourly retention cleanup: the server exports a `scheduled` handler next to `fetch`.
  crons: ["0 * * * *"],
  dev: {
    port: 3300,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "notifier",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    // The docs site (apps/fumadocs) is a static export. Its small Worker only runs for
    // `/docs/*`, to serve the Markdown versions of the pages.
    const docsWorker = yield* Cloudflare.Website.StaticSite("docs", {
      cwd: "../../apps/fumadocs",
      command: "pnpm run build",
      // Always rebuild: a fresh CI checkout has no `out/` to reuse.
      memo: false,
      outdir: "out",
      main: "../../apps/fumadocs/worker.ts",
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
        runWorkerFirst: ["/docs/*"],
      },
      domain: { name: DOMAIN, zoneName: ZONE },
      workersDev: false,
    });

    return {
      docs: docsWorker.url,
      server: serverWorker.routes,
    };
  }),
);
