import { oc } from "@orpc/contract";
import { z } from "zod";

import { PageInput, pageOf, Timestamp } from "./common";
import { ERRORS } from "./errors";
import {
  ATTACHMENT_MAX_BYTES,
  Message,
  MessageId,
  PublishInput,
  PublishOutput,
  UploadAttachmentOutput,
} from "./message";
import { ProjectName } from "./project";
import { MessageResponse } from "./response";

/**
 * Public HTTP API for scripts, CI and servers. Authenticated with an access
 * token: `Authorization: Bearer nt_...`. Served as REST via oRPC's OpenAPI handler.
 */
const base = oc.errors({
  UNAUTHORIZED: ERRORS.UNAUTHORIZED,
  FORBIDDEN: ERRORS.FORBIDDEN,
  TOO_MANY_REQUESTS: ERRORS.TOO_MANY_REQUESTS,
});

export const publicContract = {
  messages: {
    publish: base
      .route({
        method: "POST",
        path: "/v1/projects/{project}/messages",
        successStatus: 201,
        summary: "Publish a message",
        tags: ["Messages"],
      })
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND, PAYLOAD_TOO_LARGE: ERRORS.PAYLOAD_TOO_LARGE })
      .input(PublishInput)
      .output(PublishOutput),

    list: base
      .route({
        method: "GET",
        path: "/v1/projects/{project}/messages",
        summary: "List a project's messages, newest first",
        tags: ["Messages"],
      })
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND })
      .input(PageInput.extend({ project: ProjectName, since: Timestamp.optional() }))
      .output(pageOf(Message)),

    get: base
      .route({
        method: "GET",
        path: "/v1/messages/{id}",
        summary: "Get one message",
        tags: ["Messages"],
      })
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND })
      .input(z.object({ id: MessageId }))
      .output(Message),

    responses: base
      .route({
        method: "GET",
        path: "/v1/messages/{id}/responses",
        summary: "List replies and acknowledgements to a message",
        tags: ["Messages"],
      })
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND })
      .input(PageInput.extend({ id: MessageId }))
      .output(pageOf(MessageResponse)),
  },

  attachments: {
    upload: base
      .route({
        method: "POST",
        path: "/v1/projects/{project}/attachments",
        successStatus: 201,
        summary: "Upload a file to attach to the next message (multipart/form-data)",
        tags: ["Attachments"],
      })
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND, PAYLOAD_TOO_LARGE: ERRORS.PAYLOAD_TOO_LARGE })
      .input(z.object({ project: ProjectName, file: z.file().max(ATTACHMENT_MAX_BYTES) }))
      .output(UploadAttachmentOutput),
  },
};

export type PublicContract = typeof publicContract;
