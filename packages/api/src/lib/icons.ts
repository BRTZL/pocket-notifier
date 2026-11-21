/**
 * Project icons. An owner either uploads an image (`projects.setIcon`), stored in R2 at
 * `icons/<project id>/<sha-256 prefix>-<random>.<ext>` and served from `/api/icons/...`,
 * or sets any HTTPS URL. Every upload gets its own key, so two writes never share an
 * object. `iconUrl` changes by compare-and-set, and the replaced icon's object is deleted
 * only by the write that replaced it; icons live as long as their project.
 */
import { PROJECT_ICON_MAX_BYTES, type ProjectIconContentType } from "@notifier/contract/project";
import type { Database } from "@notifier/db";
import { project } from "@notifier/db/schema/notifier";
import { randomBase62 } from "@notifier/db/secrets";
import { and, eq, sql } from "drizzle-orm";

import { appError, badRequest } from "./errors";
import { type Files, sha256HexOf } from "./files";

const EXTENSIONS: Record<ProjectIconContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
/** Hex characters of the content hash in the file name. */
const HASH_PREFIX_LENGTH = 16;
/** Random characters after the hash, so every upload has its own key. */
const RANDOM_LENGTH = 10;
/** Compare-and-set attempts before a concurrent icon change wins. */
const SWAP_ATTEMPTS = 3;
/** `<hash prefix>-<random>.<ext>`, as written by `setProjectIcon`. */
export const ICON_FILE = /^[0-9a-f]{16}-[0-9A-Za-z]{10}\.(?:png|jpg|webp)$/u;
const ICON_PATH =
  /^\/api\/icons\/(?<projectId>prj_[0-9a-z]{26})\/(?<file>[0-9a-f]{16}-[0-9A-Za-z]{10}\.(?:png|jpg|webp))$/u;

export function iconKey(projectId: string, file: string): string {
  return `icons/${projectId}/${file}`;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Whether the file's first bytes are those of `contentType`. */
export function matchesImageType(bytes: Uint8Array, contentType: ProjectIconContentType): boolean {
  switch (contentType) {
    case "image/png":
      return startsWith(bytes, PNG);
    case "image/jpeg":
      return startsWith(bytes, JPEG);
    case "image/webp":
      return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);
    default:
      return false;
  }
}

function decodeBase64(data: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw badRequest("data is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The R2 key of `url` when it is an icon this deployment stored for `projectId`, else
 * `null`. Another project's uploaded icon (an owner may point at any URL) is never ours
 * to delete.
 */
export function ownIconKey(files: Files, projectId: string, url: string | null): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== files.origin || parsed.search || parsed.hash) {
    return null;
  }
  const match = ICON_PATH.exec(parsed.pathname)?.groups;
  if (!(match?.projectId === projectId && match.file)) {
    return null;
  }
  return iconKey(projectId, match.file);
}

/** Deletes the previous icon's object when it was ours and is no longer used. */
export async function deleteReplacedIcon(
  files: Files,
  projectId: string,
  previous: string | null,
  next: string | null,
): Promise<void> {
  const oldKey = ownIconKey(files, projectId, previous);
  if (oldKey && oldKey !== ownIconKey(files, projectId, next)) {
    try {
      await files.bucket.delete(oldKey);
    } catch (error) {
      // The new icon is already saved; a leftover object only costs storage.
      console.error("deleting a replaced project icon failed", error);
    }
  }
}

/**
 * Sets the project's `iconUrl` to `next` (with `extra` columns) by compare-and-set on the
 * value read just before, retrying when another write changed it in between. Only after
 * its own write succeeded does it delete the icon it replaced, so a concurrent change
 * never loses the icon that is current. `false` when the project is gone.
 */
export async function swapIconUrl(
  db: Database,
  files: Files,
  args: {
    projectId: string;
    next: string | null;
    extra?: Partial<Omit<typeof project.$inferInsert, "iconUrl">>;
  },
): Promise<boolean> {
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each attempt re-reads after a lost race.
    const [current] = await db
      .select({ iconUrl: project.iconUrl })
      .from(project)
      .where(eq(project.id, args.projectId))
      .limit(1);
    if (!current) {
      return false;
    }
    const swapped = await db
      .update(project)
      .set({ ...args.extra, iconUrl: args.next })
      .where(and(eq(project.id, args.projectId), sql`${project.iconUrl} is ${current.iconUrl}`))
      .returning({ id: project.id });
    if (swapped.length > 0) {
      await deleteReplacedIcon(files, args.projectId, current.iconUrl, args.next);
      return true;
    }
  }
  throw appError("CONFLICT", "The project's icon changed at the same time. Try again.");
}

/**
 * Checks and stores an uploaded icon under a new key, points `iconUrl` at it and deletes
 * the icon it replaces. The caller checks that the user owns the project.
 */
export async function setProjectIcon(
  db: Database,
  files: Files,
  args: { projectId: string; contentType: ProjectIconContentType; data: string },
): Promise<void> {
  const bytes = decodeBase64(args.data);
  if (bytes.length === 0) {
    throw badRequest("The icon is empty");
  }
  if (bytes.length > PROJECT_ICON_MAX_BYTES) {
    throw badRequest(`The icon is larger than ${PROJECT_ICON_MAX_BYTES} bytes`);
  }
  if (!matchesImageType(bytes, args.contentType)) {
    throw badRequest(`The data is not a ${args.contentType} image`);
  }
  const hash = (await sha256HexOf(bytes)).slice(0, HASH_PREFIX_LENGTH);
  const file = `${hash}-${randomBase62(RANDOM_LENGTH)}.${EXTENSIONS[args.contentType]}`;
  const key = iconKey(args.projectId, file);
  await files.bucket.put(key, bytes, { httpMetadata: { contentType: args.contentType } });
  const iconUrl = `${files.origin}/api/icons/${args.projectId}/${file}`;
  let swapped = false;
  try {
    swapped = await swapIconUrl(db, files, { projectId: args.projectId, next: iconUrl });
  } finally {
    if (!swapped) {
      // Nothing points at the new object.
      await files.bucket.delete(key).catch(() => undefined);
    }
  }
  if (!swapped) {
    throw appError("NOT_FOUND", "Project not found");
  }
}
