import type { PublicContract } from "@notifier/contract/public";
import type { Database } from "@notifier/db";
import { ORPCError, type Router } from "@orpc/server";

import { attachmentOf, storeUpload } from "../lib/attachments";
import { appError } from "../lib/errors";
import { FileTooLargeError } from "../lib/files";
import {
  announcePublished,
  findMessage,
  listProjectMessages,
  publishMessage,
  toMessage,
  toPublishOutput,
} from "../lib/messages";
import { listResponses } from "../lib/responses";
import { recordT3Heartbeat, reportT3Status } from "../lib/t3-status";
import { type ProjectRow, type TokenAuth, tokenCanPublish, tokenCanRead } from "./auth";
import { type PublicContext, tokenAuthed } from "./base";

const publish = tokenAuthed.messages.publish.handler(async ({ context, input }) => {
  const { db, auth } = context;
  const target = await tokenCanPublish(db, auth, input.project);
  const row = await publishMessage(db, {
    project: target,
    publisher: { userId: auth.user.id, tokenId: auth.token.id },
    input,
  });
  announcePublished(
    context.dispatch,
    toMessage(
      row.message,
      target.name,
      auth.user,
      attachmentOf(row.attachment, context.files.origin),
    ),
  );
  return toPublishOutput(row, target.name);
});

const list = tokenAuthed.messages.list.handler(async ({ context, input }) => {
  const target = await tokenCanRead(context.db, context.auth, input.project);
  return listProjectMessages(context.db, {
    projectId: target.id,
    cursor: input.cursor,
    since: input.since,
    limit: input.limit,
    origin: context.files.origin,
  });
});

/**
 * A message the token can read. Missing, expired, out-of-scope and not-a-member all
 * look the same (`NOT_FOUND`), so a token cannot probe for other projects' message ids.
 */
async function readableMessage(db: Database, auth: TokenAuth, id: string) {
  const found = await findMessage(db, id);
  if (!found) {
    throw appError("NOT_FOUND", "Message not found");
  }
  const notFound = () => appError("NOT_FOUND", "Message not found");
  let authorized: ProjectRow;
  try {
    authorized = await tokenCanRead(db, auth, found.projectName);
  } catch (error) {
    if (error instanceof ORPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
      throw notFound();
    }
    throw error;
  }
  // The check ran by project name; make sure it authorized this message's own project.
  if (authorized.id !== found.message.projectId) {
    throw notFound();
  }
  return found;
}

const get = tokenAuthed.messages.get.handler(async ({ context, input }) => {
  const found = await readableMessage(context.db, context.auth, input.id);
  return toMessage(
    found.message,
    found.projectName,
    found.publisher,
    attachmentOf(found.attachment, context.files.origin),
  );
});

const responses = tokenAuthed.messages.responses.handler(async ({ context, input }) => {
  const found = await readableMessage(context.db, context.auth, input.id);
  // Readable, so only the role check can fail here: FORBIDDEN for subscribers.
  const publishable = await tokenCanPublish(context.db, context.auth, found.projectName);
  if (publishable.id !== found.message.projectId) {
    throw appError("NOT_FOUND", "Message not found");
  }
  return listResponses(context.db, {
    messageId: found.message.id,
    cursor: input.cursor,
    limit: input.limit,
  });
});

/**
 * Upload through oRPC, with the file already parsed: in-process clients and tests. Over
 * HTTP the handler sends this path to the streaming `./upload` instead, which never
 * buffers the body.
 */
const upload = tokenAuthed.attachments.upload.handler(async ({ context, input, errors }) => {
  const target = await tokenCanPublish(context.db, context.auth, input.project);
  // zod types `z.file()` from `globalThis.File`, which it cannot infer with both the Node
  // and the Workers types loaded; at runtime it is the platform's `File`.
  const file = input.file as unknown as File;
  try {
    const row = await storeUpload(context.db, context.files, {
      projectId: target.id,
      uploader: { userId: context.auth.user.id, tokenId: context.auth.token.id },
      fileName: file.name,
      contentType: file.type,
      stream: file.stream(),
    });
    return { id: row.id, expiresAt: row.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      throw errors.PAYLOAD_TOO_LARGE({ data: { maxBytes: error.maxBytes } });
    }
    throw error;
  }
});

/**
 * A thread's status from the T3 bridge. The bridge may create the repo's project, so a
 * token scoped to some projects only reports threads of those projects.
 */
const threadStatus = tokenAuthed.t3.threadStatus.handler(async ({ context, input }) => {
  const { auth } = context;
  if (auth.scope.kind === "projects" && !auth.scope.projects.includes(input.project.name)) {
    throw appError("FORBIDDEN", "This token's scope does not include the project");
  }
  return await reportT3Status(context.db, {
    userId: auth.user.id,
    input,
    dispatch: context.dispatch,
    files: context.files,
  });
});

const heartbeat = tokenAuthed.t3.heartbeat.handler(async ({ context, input }) => {
  await recordT3Heartbeat(context.db, {
    userId: context.auth.user.id,
    environmentId: input.environmentId,
  });
});

/** Implements all of `publicContract`. */
export const publicRouter = {
  messages: tokenAuthed.messages.router({ publish, list, get, responses }),
  attachments: tokenAuthed.attachments.router({ upload }),
  t3: tokenAuthed.t3.router({ threadStatus, heartbeat }),
} satisfies Router<PublicContract, PublicContext>;

export type PublicRouter = typeof publicRouter;
