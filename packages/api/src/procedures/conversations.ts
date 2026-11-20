import { authed } from "../base";
import { listConversations } from "../lib/conversations";

const list = authed.conversations.list.handler(({ context, input }) =>
  listConversations(context.db, {
    userId: context.session.user.id,
    cursor: input.cursor,
    limit: input.limit,
  }),
);

export const conversationsRouter = authed.conversations.router({ list });
