import { appContract } from "@notifier/contract/app";
import { implement } from "@orpc/server";

import type { Context } from "./context";
import { appError } from "./lib/errors";

/** Implements `appContract`; every procedure starts from here. */
export const os = implement(appContract).$context<Context>();

const requireSession = os.middleware(({ context, next }) => {
  if (!context.session) {
    throw appError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});

/** Procedures that need a signed-in user. `context.session` is non-null here. */
export const authed = os.use(requireSession);
