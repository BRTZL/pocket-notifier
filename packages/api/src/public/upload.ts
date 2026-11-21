/**
 * `POST /v1/projects/{project}/attachments` over HTTP. The oRPC handler would buffer the
 * whole multipart body (and the `/v1` body cap would refuse it), so the handler routes
 * this path here first: the token and project are checked before any of the body is
 * read, then the `file` field streams to R2 (`readMultipartFile`, `storeUpload`).
 *
 * Responses and errors have the same JSON shapes as the oRPC route in `./router`.
 */
import { ATTACHMENT_MAX_BYTES, UploadAttachmentOutput } from "@notifier/contract/message";
import { ProjectName } from "@notifier/contract/project";
import { ORPCError } from "@orpc/server";

import { storeUpload } from "../lib/attachments";
import { badRequest } from "../lib/errors";
import { FileTooLargeError } from "../lib/files";
import { MultipartError, multipartBoundary, readMultipartFile } from "../lib/multipart";
import { authenticateToken, tokenCanPublish } from "./auth";
import type { PublicContext } from "./base";
import { payloadTooLarge } from "./body-limit";

/** Room for the multipart boundaries and part headers around the file. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const UPLOAD_PATH = /^\/v1\/projects\/(?<project>[^/]+)\/attachments\/?$/u;

/** The project name when `pathname` (without the mount prefix) is the upload route. */
export function matchUploadPath(pathname: string): string | null {
  const encoded = UPLOAD_PATH.exec(pathname)?.groups?.project;
  if (!encoded) {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function errorResponse(error: ORPCError<string, unknown>): Response {
  return Response.json(error.toJSON(), { status: error.status });
}

async function upload(request: Request, projectParam: string, context: PublicContext) {
  const auth = await authenticateToken(context.db, context.authorization);
  const projectName = ProjectName.safeParse(projectParam);
  if (!projectName.success) {
    throw new ORPCError("NOT_FOUND", { status: 404, message: "Project not found" });
  }
  const target = await tokenCanPublish(context.db, auth, projectName.data);

  const boundary = multipartBoundary(request.headers.get("Content-Type"));
  if (!boundary) {
    throw badRequest('Send the file as multipart/form-data in a field named "file"');
  }
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return payloadTooLarge(ATTACHMENT_MAX_BYTES);
  }
  if (!request.body) {
    throw badRequest('Send the file as multipart/form-data in a field named "file"');
  }
  const file = await readMultipartFile(request.body, boundary, "file");
  const row = await storeUpload(context.db, context.files, {
    projectId: target.id,
    uploader: { userId: auth.user.id, tokenId: auth.token.id },
    fileName: file.fileName,
    contentType: file.contentType,
    stream: file.stream,
  });
  const body = UploadAttachmentOutput.parse({
    id: row.id,
    expiresAt: row.expiresAt.toISOString(),
  });
  return Response.json(body, { status: 201 });
}

/** Handles one upload request; never throws. */
export async function handleUpload(
  request: Request,
  projectParam: string,
  context: PublicContext,
): Promise<Response> {
  if (request.method !== "POST") {
    await request.body?.cancel();
    return Response.json(
      { defined: false, code: "METHOD_NOT_SUPPORTED", status: 405, message: "Use POST" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  try {
    return await upload(request, projectParam, context);
  } catch (error) {
    await request.body?.cancel().catch(() => undefined);
    if (error instanceof FileTooLargeError) {
      return payloadTooLarge(ATTACHMENT_MAX_BYTES);
    }
    if (error instanceof MultipartError) {
      return errorResponse(badRequest(error.message));
    }
    if (error instanceof ORPCError) {
      return errorResponse(error);
    }
    console.error("attachment upload failed", error);
    return Response.json(
      {
        defined: false,
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        message: "Internal server error",
      },
      { status: 500 },
    );
  }
}
