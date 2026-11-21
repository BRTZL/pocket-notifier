/**
 * Message attachments: one file per message, stored in R2 under
 * `attachments/<project id>/<attachment id>`.
 *
 * A file is uploaded first (REST multipart, the app API, or an MCP upload link) and stored
 * as an `uploaded` row with no message. A publish with its `attachmentId` links it; the
 * row then takes the message's `expiresAt`, so retention deletes the file with its
 * message. Uploads never linked are deleted `UNUSED_UPLOAD_TTL_MS` after the upload.
 *
 * Downloads go through `/api/attachments/<id>/<download token>/<name>`: the token is
 * random (about 190 bits), so the URL works without a session (notification images,
 * video players, sharing) until the message expires.
 */
import {
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  attachmentKind,
  UNUSED_UPLOAD_TTL_MS,
} from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { attachment, message } from "@notifier/db/schema/notifier";
import { randomBase62, sha256Hex } from "@notifier/db/secrets";
import { and, eq, gt, type SQL, sql } from "drizzle-orm";

import { badRequest } from "./errors";
import { constantTimeEqual, deleteKeys, type Files, FileTooLargeError, writeObject } from "./files";

export type AttachmentRow = typeof attachment.$inferSelect;

/** An MCP upload link works this long. */
export const UPLOAD_LINK_TTL_MS = 60 * 60 * 1000;
/** Download tokens: 32 base62 characters, about 190 random bits. */
const DOWNLOAD_TOKEN_LENGTH = 32;
const UPLOAD_TOKEN_LENGTH = 32;
const NAME_MAX = 255;
const FALLBACK_NAME = "file";
const OCTET_STREAM = "application/octet-stream";

const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
/**
 * Control characters (C0, DEL, C1), bidi overrides and marks (which can make
 * `invoice<U+202E>fdp.exe` read as a PDF), and characters reserved in file names.
 */
const UNSAFE_NAME_CHARS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069"\\/:*?<>|]+/gu;
const WHITESPACE_RUN = /\s+/gu;
const LEADING_DOTS = /^\.+/u;
const PATH_SEPARATORS = /[\\/]/u;

export function attachmentKey(projectId: string, attachmentId: string): string {
  return `attachments/${projectId}/${attachmentId}`;
}

/**
 * A file name safe to store, show and send in `Content-Disposition`: the last path
 * segment, without control characters, quotes, slashes or other reserved characters,
 * cut to 255 characters. `"file"` when nothing is left.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(PATH_SEPARATORS).at(-1) ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(UNSAFE_NAME_CHARS, "_")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .replace(LEADING_DOTS, "");
  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(cleaned),
  ];
  let out = "";
  for (const { segment } of graphemes) {
    if (out.length + segment.length > NAME_MAX) {
      break;
    }
    out += segment;
  }
  return out || FALLBACK_NAME;
}

/**
 * `type/subtype` in lowercase, without parameters; `application/octet-stream` when the
 * value is missing or not a plain media type. Only the kind (image, video, pdf, file)
 * decides how a download is served, never the raw value.
 */
export function normalizeContentType(raw: string | null | undefined): string {
  const value = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPE.test(value) ? value : OCTET_STREAM;
}

export function downloadUrl(origin: string, row: AttachmentRow): string {
  return `${origin}/api/attachments/${row.id}/${row.downloadToken}/${encodeURIComponent(row.name)}`;
}

/** The contract `Attachment` of a linked row. */
export function toAttachment(row: AttachmentRow, origin: string): Attachment {
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    kind: attachmentKind(row.contentType),
    url: downloadUrl(origin, row),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** `toAttachment` for a left-joined row that may be missing. */
export function attachmentOf(row: AttachmentRow | null, origin: string): Attachment | null {
  return row ? toAttachment(row, origin) : null;
}

type Uploader = { userId: string; tokenId: string | null };

/**
 * Stores `stream` as a new upload in `projectId` and returns the `uploaded` row. The row
 * is written `pending` first, so a failed or abandoned write is still swept by
 * retention. Throws `FileTooLargeError` past `ATTACHMENT_MAX_BYTES`.
 */
export async function storeUpload(
  db: Database,
  files: Files,
  args: {
    projectId: string;
    uploader: Uploader;
    fileName: string;
    contentType: string | null;
    stream: ReadableStream<Uint8Array>;
    now?: Date;
  },
): Promise<AttachmentRow> {
  const now = args.now ?? new Date();
  const id = newId("attachment");
  const key = attachmentKey(args.projectId, id);
  const contentType = normalizeContentType(args.contentType);
  await db.insert(attachment).values({
    id,
    projectId: args.projectId,
    uploadedBy: args.uploader.userId,
    tokenId: args.uploader.tokenId,
    name: sanitizeFileName(args.fileName),
    contentType,
    size: 0,
    r2Key: key,
    downloadToken: randomBase62(DOWNLOAD_TOKEN_LENGTH),
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + UNUSED_UPLOAD_TTL_MS),
  });
  let size: number;
  try {
    ({ size } = await writeObject(files.bucket, key, args.stream, {
      contentType,
      maxBytes: ATTACHMENT_MAX_BYTES,
    }));
  } catch (error) {
    await db.delete(attachment).where(eq(attachment.id, id));
    throw error;
  }
  const [row] = await db
    .update(attachment)
    .set({ status: "uploaded", size })
    .where(eq(attachment.id, id))
    .returning();
  if (!row) {
    throw new Error("attachment update returned no row");
  }
  return row;
}

/** The pieces of an MCP upload link; `token` is shown once and only its hash is kept. */
export type UploadLink = { row: AttachmentRow; token: string; url: string };

/**
 * Creates a `pending` upload with a one-time link: `PUT <url>` with the raw file as the
 * body, within `UPLOAD_LINK_TTL_MS`, at most `size` bytes. The caller checks access.
 */
export async function createUploadLink(
  db: Database,
  files: Files,
  args: {
    projectId: string;
    userId: string;
    fileName: string;
    contentType: string;
    size: number;
    now?: Date;
  },
): Promise<UploadLink> {
  if (!Number.isInteger(args.size) || args.size < 0 || args.size > ATTACHMENT_MAX_BYTES) {
    throw badRequest(`size must be between 0 and ${ATTACHMENT_MAX_BYTES} bytes`);
  }
  const now = args.now ?? new Date();
  const id = newId("attachment");
  const token = randomBase62(UPLOAD_TOKEN_LENGTH);
  const [row] = await db
    .insert(attachment)
    .values({
      id,
      projectId: args.projectId,
      uploadedBy: args.userId,
      name: sanitizeFileName(args.fileName),
      contentType: normalizeContentType(args.contentType),
      size: args.size,
      r2Key: attachmentKey(args.projectId, id),
      downloadToken: randomBase62(DOWNLOAD_TOKEN_LENGTH),
      uploadTokenHash: await sha256Hex(token),
      uploadExpiresAt: new Date(now.getTime() + UPLOAD_LINK_TTL_MS),
      status: "pending",
      createdAt: now,
      expiresAt: new Date(now.getTime() + UNUSED_UPLOAD_TTL_MS),
    })
    .returning();
  if (!row) {
    throw new Error("attachment insert returned no row");
  }
  const query = new URLSearchParams({ token });
  return { row, token, url: `${files.origin}/api/uploads/${id}?${query.toString()}` };
}

export type UploadOutcome =
  | { status: "uploaded"; row: AttachmentRow }
  | { status: "not_found" }
  | { status: "too_large"; maxBytes: number };

/**
 * Takes the body of `PUT /api/uploads/<id>?token=...`. The link is used up before the
 * body is read, so it works once even when two requests race; a failed write leaves a
 * `pending` row that retention sweeps. Wrong, used and expired links all look the same.
 */
export async function acceptUpload(
  db: Database,
  files: Files,
  args: {
    attachmentId: string;
    token: string;
    contentLength: number | null;
    body: ReadableStream<Uint8Array> | null;
    now?: Date;
  },
): Promise<UploadOutcome> {
  const now = args.now ?? new Date();
  if (!args.token) {
    return { status: "not_found" };
  }
  const [claimed] = await db
    .update(attachment)
    .set({ uploadTokenHash: null })
    .where(
      and(
        eq(attachment.id, args.attachmentId),
        eq(attachment.uploadTokenHash, await sha256Hex(args.token)),
        eq(attachment.status, "pending"),
        gt(attachment.uploadExpiresAt, now),
      ),
    )
    .returning();
  if (!claimed) {
    return { status: "not_found" };
  }
  const maxBytes = claimed.size;
  if (args.contentLength !== null && args.contentLength > maxBytes) {
    await args.body?.cancel();
    return { status: "too_large", maxBytes };
  }
  const body = args.body ?? new Blob([]).stream();
  let size: number;
  try {
    ({ size } = await writeObject(files.bucket, claimed.r2Key, body, {
      contentType: claimed.contentType,
      maxBytes,
    }));
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return { status: "too_large", maxBytes };
    }
    throw error;
  }
  const [row] = await db
    .update(attachment)
    .set({ status: "uploaded", size })
    .where(eq(attachment.id, claimed.id))
    .returning();
  if (!row) {
    throw new Error("attachment update returned no row");
  }
  return { status: "uploaded", row };
}

export type AttachTarget = {
  attachmentId: string;
  projectId: string;
  /** The publishing user; only the uploader may attach an upload. */
  userId: string;
  now: Date;
};

/**
 * The upload `attachmentId` if `userId` may attach it to a publish in `projectId`:
 * uploaded by them, in that project, not attached to a message, and not past its
 * unused-upload expiry. Anything else is a `BAD_REQUEST` with the reason. This is the
 * friendly preflight; `attachableWhere` re-checks the same rules inside the publish write.
 */
export async function attachableUpload(db: Database, args: AttachTarget): Promise<AttachmentRow> {
  const [row] = await db
    .select()
    .from(attachment)
    .where(eq(attachment.id, args.attachmentId))
    .limit(1);
  if (!row || row.projectId !== args.projectId || row.uploadedBy !== args.userId) {
    throw badRequest(
      "Attachment not found in this project. Upload the file to this project first.",
    );
  }
  if (row.messageId !== null) {
    throw badRequest("This attachment is already attached to a message. Upload the file again.");
  }
  if (row.status !== "uploaded") {
    throw badRequest("This attachment has not been uploaded yet. Upload the file, then publish.");
  }
  if (row.expiresAt <= args.now) {
    throw badRequest("This upload has expired. Upload the file again.");
  }
  return row;
}

/**
 * The rules of `attachableUpload` as SQL on the `attachment` row, evaluated inside the
 * publish write: uploaded by `userId`, in the project, unlinked, and `expires_at` still
 * ahead (retention claims an upload by setting it to 0 before deleting it).
 */
export function attachableWhere(args: AttachTarget): SQL {
  return sql`${attachment.id} = ${args.attachmentId} and ${attachment.projectId} = ${args.projectId} and ${attachment.uploadedBy} = ${args.userId} and ${attachment.status} = 'uploaded' and ${attachment.messageId} is null and ${attachment.expiresAt} > ${args.now.getTime()}`;
}

/**
 * Links an upload to its new message. Runs in the same batch right after the
 * conditional message insert: it matches only when that insert happened (the message
 * exists) and the upload is still attachable, which the insert checked in the same
 * transaction.
 */
export function linkAttachment(
  db: Database,
  args: AttachTarget & { messageId: string; expiresAt: Date },
) {
  return db
    .update(attachment)
    .set({ messageId: args.messageId, expiresAt: args.expiresAt })
    .where(
      and(
        attachableWhere(args),
        sql`exists (select 1 from ${message} where ${message.id} = ${args.messageId})`,
      ),
    )
    .returning();
}

/** Deletes the attachments of `messageIds` from R2 and then their rows. */
export async function deleteMessageAttachments(
  db: Database,
  files: Files,
  messageIds: readonly string[],
): Promise<void> {
  if (messageIds.length === 0) {
    return;
  }
  // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
  const inIds = sql`${attachment.messageId} in (select value from json_each(${JSON.stringify(messageIds)}))`;
  const rows = await db.select({ key: attachment.r2Key }).from(attachment).where(inIds);
  await deleteKeys(
    files.bucket,
    rows.map((row) => row.key),
  );
  await db.delete(attachment).where(inIds);
}

/**
 * The attachment a download URL names, or `undefined` for a wrong token, an upload not
 * attached to a message, or an expired one: all answered with the same 404.
 */
export async function findDownload(
  db: Database,
  args: { attachmentId: string; token: string; now?: Date },
): Promise<AttachmentRow | undefined> {
  const now = args.now ?? new Date();
  const [row] = await db
    .select()
    .from(attachment)
    .where(eq(attachment.id, args.attachmentId))
    .limit(1);
  if (!row) {
    return;
  }
  // Compare in constant time; the id lookup above is by primary key, not by token.
  if (!constantTimeEqual(row.downloadToken, args.token)) {
    return;
  }
  if (row.status !== "uploaded" || row.messageId === null || row.expiresAt <= now) {
    return;
  }
  return row;
}
