/**
 * The public file routes, as plain `Request` to `Response` functions the server mounts
 * (no session, any origin):
 *
 * - `GET /api/icons/<project id>/<file>`: an uploaded project icon.
 * - `GET /api/attachments/<id>/<token>/<name>`: an attachment, with HTTP range support.
 * - `PUT /api/uploads/<id>?token=<token>`: the body of an MCP upload link.
 *
 * Every miss is the same bare 404, so a wrong token tells nothing.
 */
import { AttachmentId, attachmentKind } from "@notifier/contract/message";
import { ProjectId } from "@notifier/contract/project";
import type { Database } from "@notifier/db";

import { type AttachmentRow, acceptUpload, findDownload } from "./attachments";
import type { Files } from "./files";
import { ICON_FILE, iconKey } from "./icons";

const ONE_YEAR_SECONDS = 31_536_000;
const RANGE = /^bytes=(?<start>\d*)-(?<end>\d*)$/u;
const QUOTED_UNSAFE = /["\\]/gu;
const NON_ASCII = /[^\u0020-\u007e]/gu;
const DIGITS = /^\d+$/u;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/** Serves an uploaded project icon. Icon file names are content hashes, so they never change. */
export async function serveIcon(
  files: Files,
  params: { projectId: string; file: string },
): Promise<Response> {
  if (!(ProjectId.safeParse(params.projectId).success && ICON_FILE.test(params.file))) {
    return notFound();
  }
  const object = await files.bucket.get(iconKey(params.projectId, params.file));
  if (!object) {
    return notFound();
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Length": String(object.size),
      "Cache-Control": `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

/** `attachment; filename="..."; filename*=UTF-8''...`: an ASCII fallback plus the real name. */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const fallback = name.replace(NON_ASCII, "_").replace(QUOTED_UNSAFE, "_");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

type ByteRange = { offset: number; length: number };

/**
 * One `bytes=` range of a `size`-byte file: `bytes=a-b`, `bytes=a-` or `bytes=-n`.
 * `null` without a header (or for several ranges, which are served whole);
 * `"unsatisfiable"` when it starts past the end.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) {
    return null;
  }
  const match = RANGE.exec(header.trim())?.groups;
  if (!match) {
    return null;
  }
  const { start = "", end = "" } = match;
  if (start === "" && end === "") {
    return null;
  }
  if (start === "") {
    const suffix = Number(end);
    if (suffix === 0 || size === 0) {
      return "unsatisfiable";
    }
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const first = Number(start);
  if (first >= size) {
    return "unsatisfiable";
  }
  const last = end === "" ? size - 1 : Math.min(Number(end), size - 1);
  if (last < first) {
    return null;
  }
  return { offset: first, length: last - first + 1 };
}

function downloadHeaders(row: AttachmentRow): Headers {
  const kind = attachmentKind(row.contentType);
  const inline = kind === "image" || kind === "video" || kind === "pdf";
  return new Headers({
    "Content-Type": row.contentType,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.name),
    "Accept-Ranges": "bytes",
    // Revalidated on every use, so a deleted or expired file stops being served at once.
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    // Images may render, nothing may run; everything else is also sandboxed (a PDF or an
    // HTML file opened in a tab gets no scripts and no same-origin access).
    "Content-Security-Policy":
      kind === "image" ? "default-src 'none'" : "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
}

/** Streams an attachment; a `Range` request gets a 206 with that slice. */
export async function serveAttachment(
  db: Database,
  files: Files,
  request: Request,
  params: { attachmentId: string; token: string },
): Promise<Response> {
  if (!AttachmentId.safeParse(params.attachmentId).success) {
    return notFound();
  }
  const now = new Date();
  const row = await findDownload(db, { ...params, now });
  if (!row) {
    return notFound();
  }
  const headers = downloadHeaders(row);
  const range = parseRange(request.headers.get("Range"), row.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${row.size}`);
    headers.delete("Content-Disposition");
    return new Response(null, { status: 416, headers });
  }
  const object = await files.bucket.get(row.r2Key, range ? { range } : undefined);
  if (!object) {
    return notFound();
  }
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`,
    );
    headers.set("Content-Length", String(range.length));
  } else {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("ETag", object.httpEtag);
  const body = request.method === "HEAD" ? null : object.body;
  return new Response(body, { status: range ? 206 : 200, headers });
}

/**
 * Takes the body of an MCP upload link. 200 with `{ attachmentId, size }`; 404 for a
 * wrong, used or expired link; 413 past the size declared in `create_upload`.
 */
export async function receiveUpload(
  db: Database,
  files: Files,
  request: Request,
  params: { attachmentId: string; token: string },
): Promise<Response> {
  if (!AttachmentId.safeParse(params.attachmentId).success) {
    await request.body?.cancel();
    return notFound();
  }
  const declared = request.headers.get("Content-Length");
  const contentLength = declared !== null && DIGITS.test(declared) ? Number(declared) : null;
  const outcome = await acceptUpload(db, files, {
    attachmentId: params.attachmentId,
    token: params.token,
    contentLength,
    body: request.body,
  });
  if (outcome.status === "not_found") {
    await request.body?.cancel().catch(() => undefined);
    return notFound();
  }
  if (outcome.status === "too_large") {
    return Response.json(
      {
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
        message: `The file is larger than the ${outcome.maxBytes} bytes declared in create_upload. Create a new upload with the right size.`,
        data: { maxBytes: outcome.maxBytes },
      },
      { status: 413 },
    );
  }
  return Response.json({
    attachmentId: outcome.row.id,
    size: outcome.row.size,
    message: "Uploaded. Pass attachmentId to send_notification.",
  });
}
