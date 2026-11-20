import type { Dispatch } from "@notifier/api/dispatch";
import { findOAuthClient, handleMcpRequest } from "@notifier/api/mcp/handler";
import { pushSetupFromSecret } from "@notifier/api/push/config";
import { createAuth as createConfiguredAuth, protectMcp, verifyOAuthQuery } from "@notifier/auth";
import { createDb, type Database } from "@notifier/db";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext } from "hono";

import { createDispatch } from "./dispatch";
import { ENV } from "./env.server";
import type { OAuthPageDeps } from "./oauth/routes";

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

/** What the OAuth sign-in and consent pages need from auth and the database. */
export function oauthPageDeps(): OAuthPageDeps {
  return {
    authOrigin: new URL(ENV.BETTER_AUTH_URL).origin,
    authHandler: async (request) => (await createAuth()).handler(request),
    getSessionUser: async (headers) =>
      (await (await createAuth()).api.getSession({ headers }))?.user ?? null,
    verifyOAuthQuery: (oauthQuery) => verifyOAuthQuery(ENV, oauthQuery),
    findClient: (clientId) =>
      clientId ? findOAuthClient(getDb(), clientId) : Promise.resolve(null),
  };
}

/** `/mcp`: OAuth bearer token check, then the stateless MCP server for that user. */
export async function serveMcp(c: HonoContext<EvlogVariables>): Promise<Response> {
  const db = getDb();
  const dispatch = await requestDispatch(c, db);
  const protectedHandler = protectMcp(await createAuth(db), ENV, (request, claims) =>
    handleMcpRequest(request, claims, { db, dispatch }),
  );
  return protectedHandler(c.req.raw);
}
