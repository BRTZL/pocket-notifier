import type { PublicContract } from "@notifier/contract/public";
import type { Database } from "@notifier/db";
import { ORPCError, type Router } from "@orpc/server";

import { appError } from "../lib/errors";
import {
  announcePublished,
  findMessage,
  listTopicMessages,
  publishMessage,
  toMessage,
  toPublishOutput,
} from "../lib/messages";
import { listResponses } from "../lib/responses";
import { type TokenAuth, type TopicRow, tokenCanPublish, tokenCanRead } from "./auth";
import { type PublicContext, tokenAuthed } from "./base";

const publish = tokenAuthed.messages.publish.handler(async ({ context, input }) => {
  const { db, auth } = context;
  const target = await tokenCanPublish(db, auth, input.topic);
  const row = await publishMessage(db, {
    topic: target,
    publisher: { userId: auth.user.id, tokenId: auth.token.id },
    input,
  });
  announcePublished(context.dispatch, toMessage(row, target.name, auth.user));
  return toPublishOutput(row, target.name);
});

const list = tokenAuthed.messages.list.handler(async ({ context, input }) => {
  const target = await tokenCanRead(context.db, context.auth, input.topic);
  return listTopicMessages(context.db, {
    topicId: target.id,
    cursor: input.cursor,
    since: input.since,
    limit: input.limit,
  });
});

/**
 * A message the token can read. Missing, expired, out-of-scope and not-a-member all
 * look the same (`NOT_FOUND`), so a token cannot probe for other topics' message ids.
 */
async function readableMessage(db: Database, auth: TokenAuth, id: string) {
  const found = await findMessage(db, id);
  if (!found) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const notFound = () => appError("NOT_FOUND", "Message not found");
  let authorized: TopicRow;
  try {
    authorized = await tokenCanRead(db, auth, found.topicName);
  } catch (error) {
    if (error instanceof ORPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
      throw notFound();
    }
    throw error;
  }
  // The check ran by topic name; make sure it authorized this message's own topic.
  if (authorized.id !== found.message.topicId) {
    throw notFound();
  }
  return found;
}

const get = tokenAuthed.messages.get.handler(async ({ context, input }) => {
  const found = await readableMessage(context.db, context.auth, input.id);
  return toMessage(found.message, found.topicName, found.publisher);
});

const responses = tokenAuthed.messages.responses.handler(async ({ context, input }) => {
  const found = await readableMessage(context.db, context.auth, input.id);
  // Readable, so only the role check can fail here: FORBIDDEN for subscribers.
  const publishable = await tokenCanPublish(context.db, context.auth, found.topicName);
  if (publishable.id !== found.message.topicId) {
    throw appError("NOT_FOUND", "Message not found");
  }
  return listResponses(context.db, {
    messageId: found.message.id,
    cursor: input.cursor,
    limit: input.limit,
  });
});

/**
 * The implemented part of `publicContract`. `attachments.upload` is left out until
 * attachments ship, so the OpenAPI handler answers its path with a 404.
 */
export const publicRouter = {
  messages: tokenAuthed.messages.router({ publish, list, get, responses }),
} satisfies Router<Pick<PublicContract, "messages">, PublicContext>;

export type PublicRouter = typeof publicRouter;
