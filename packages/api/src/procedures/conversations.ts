import { authed } from "../base";
import { getConversation, listConversations } from "../lib/conversations";
import { appError } from "../lib/errors";

const list = authed.conversations.list.handler(({ context, input }) =>
  listConversations(context.db, {
    userId: context.session.user.id,
    cursor: input.cursor,
    limit: input.limit,
  }),
);

const get = authed.conversations.get.handler(async ({ context, input }) => {
  const summary = await getConversation(context.db, context.session.user.id, input.conversation);
  if (!summary) {
    throw appError("NOT_FOUND", "Conversation not found");
  }
  return summary;
});

export const conversationsRouter = authed.conversations.router({ list, get });
