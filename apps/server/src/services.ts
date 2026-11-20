import type { Dispatch } from "@notifier/api/dispatch";
import { pushSetupFromSecret } from "@notifier/api/push/config";
import { createAuth as createConfiguredAuth } from "@notifier/auth";
import { createDb, type Database } from "@notifier/db";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext } from "hono";

import { createDispatch } from "./dispatch";
import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}

/**
 * The request's `Dispatch`. Push is configured by the optional `FCM_SERVICE_ACCOUNT`
 * secret; without a usable one, dispatch only logs that push is disabled.
 */
export async function requestDispatch(
  c: HonoContext<EvlogVariables>,
  db: Database,
): Promise<Dispatch> {
  return createDispatch({
    log: c.get("log"),
    db,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    push: await pushSetupFromSecret(ENV.FCM_SERVICE_ACCOUNT),
  });
}
