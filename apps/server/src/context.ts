import type { Context as ApiContext } from "@notifier/api/context";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb, getFiles, requestDispatch } from "./services";

const TRAILING_SLASHES = /\/+$/u;

export type CreateContextOptions = {
  context: HonoContext<EvlogVariables>;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = await getDb();
  const session = await (await createAuth(db)).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    // CORS_ORIGIN is the deployment's public origin; invite links are built on it.
    appUrl: ENV.CORS_ORIGIN.replace(TRAILING_SLASHES, ""),
    dispatch: await requestDispatch(context, db),
    files: getFiles(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
