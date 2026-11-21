import { publicContract } from "@notifier/contract/public";
import type { Database } from "@notifier/db";
import { implement } from "@orpc/server";

import type { Dispatch } from "../dispatch";
import type { Files } from "../lib/files";
import { authenticateToken } from "./auth";

export type PublicContext = {
  db: Database;
  /** The raw `Authorization` header, or `null` when the request has none. */
  authorization: string | null;
  dispatch: Dispatch;
  files: Files;
};

/** Implements `publicContract` (the `/v1` API for scripts). */
export const publicOs = implement(publicContract).$context<PublicContext>();

const requireToken = publicOs.middleware(async ({ context, next }) => {
  const auth = await authenticateToken(context.db, context.authorization);
  return next({ context: { auth } });
});

/** Public procedures start here; `context.auth` is the verified token and its user. */
export const tokenAuthed = publicOs.use(requireToken);
