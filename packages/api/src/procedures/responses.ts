import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { messageResponse } from "@notifier/db/schema/notifier";

import { authed } from "../base";
import { appError, badRequest, isUniqueViolation } from "../lib/errors";
import { findMessage, toMessage } from "../lib/messages";
import { listResponses } from "../lib/responses";
import { toMessageResponse } from "../lib/serialize";
import { requireMemberOf } from "../lib/topic-access";

const ALREADY_RESPONDED = "You have already responded to this action";

/** A non-expired message in one of the caller's topics, with the caller's role there. */
async function memberMessage(db: Database, messageId: string, userId: string) {
  const found = await findMessage(db, messageId);
  if (!found) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const membership = await requireMemberOf(db, found.message.topicId, userId, "Message not found");
  return { ...found, role: membership.role };
}

const create = authed.responses.create.handler(async ({ context, input, errors }) => {
  const { db } = context;
  const caller = context.session.user;
  const found = await memberMessage(db, input.messageId, caller.id);

  const { actions } = toMessage(found.message, found.topicName, found.publisher);
  const action = actions.find((candidate) => candidate.key === input.actionKey);
  if (!action) {
    throw badRequest(`The message has no action "${input.actionKey}"`);
  }
  if (action.type !== "reply") {
    throw badRequest(`Action "${input.actionKey}" is not a reply action`);
  }
  // The action decides the kind: an input action needs text, a plain one takes none.
  if (action.input && !input.text) {
    throw badRequest(`Action "${input.actionKey}" needs a text reply`);
  }
  if (!action.input && input.text !== undefined) {
    throw badRequest(`Action "${input.actionKey}" takes no text; send it without one`);
  }
  const kind = action.input ? "text" : "ack";

  try {
    const [row] = await db
      .insert(messageResponse)
      .values({
        id: newId("response"),
        messageId: found.message.id,
        userId: caller.id,
        actionKey: action.key,
        kind,
        text: kind === "text" ? (input.text ?? null) : null,
      })
      .returning();
    if (!row) {
      throw new Error("message_response insert returned no row");
    }
    return toMessageResponse(row, caller);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.CONFLICT({ message: ALREADY_RESPONDED });
    }
    throw error;
  }
});

const list = authed.responses.list.handler(async ({ context, input }) => {
  const found = await memberMessage(context.db, input.messageId, context.session.user.id);
  if (found.role === "subscriber") {
    throw appError("FORBIDDEN", "Only owners and publishers can read responses");
  }
  return listResponses(context.db, {
    messageId: found.message.id,
    cursor: input.cursor,
    limit: input.limit,
  });
});

export const responsesRouter = authed.responses.router({ create, list });
