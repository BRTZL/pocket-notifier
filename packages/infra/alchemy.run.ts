import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import "varlock/auto-load";

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
  env: {
    DB: db,
    CORS_ORIGIN: Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    // Optional: when unset the binding is left out and the server runs with push disabled.
    FCM_SERVICE_ACCOUNT: optionalSecret("FCM_SERVICE_ACCOUNT"),
  },
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
    const webWorker = yield* Cloudflare.Website.StaticSite("web", {
      cwd: "../../apps/web",
      command: "pnpm run build:cloudflare",
      // Rebuild shared workspace dependencies until Alchemy has a workspace-aware default memo.
      memo: false,
      outdir: ".open-next/assets",
      main: "../../apps/web/.open-next/worker.js",
      bundle: true,
      compatibility: {
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      env: {
        IMAGES: Cloudflare.Images.Images(),
        NEXT_PUBLIC_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        command: "pnpm run dev:bare",
        url: "http://localhost:3301",
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
