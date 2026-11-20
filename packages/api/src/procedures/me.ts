import { authed } from "../base";
import { toUserSummary } from "../lib/serialize";

export const meRouter = authed.me.router({
  get: authed.me.get.handler(({ context }) => toUserSummary(context.session.user)),
});
