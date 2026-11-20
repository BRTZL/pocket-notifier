import type { Context as ApiContext } from "@notifier/api/context";
import type { Context as HonoContext } from "hono";
import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";

const TRAILING_SLASHES = /\/+$/u;

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = await getDb();
  const session = await (await createAuth(db)).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    // CORS_ORIGIN is the web app's origin, where invite links are opened.
    appUrl: ENV.CORS_ORIGIN.replace(TRAILING_SLASHES, ""),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
