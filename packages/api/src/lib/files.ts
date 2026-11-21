/**
 * File storage in R2: project icons under `icons/` and message attachments under
 * `attachments/`. Writes never hand R2 a stream: a stream needs a known length there, and
 * neither a multipart part nor a chunked request body has one. Bytes are counted as they
 * arrive and written as one `put`, or as a multipart upload in equal parts once the file
 * passes one part.
 */

/// <reference types="@cloudflare/workers-types" />

/** The R2 calls notifier makes; the Worker's `FILES` binding (and Miniflare's) fit. */
export type FileBucket = Pick<
  R2Bucket,
  "put" | "get" | "delete" | "list" | "createMultipartUpload"
>;

export type Files = {
  bucket: FileBucket;
  /** The deployment's public origin, without a trailing slash; file URLs are built on it. */
  origin: string;
};

/** R2 needs equal parts of at least 5 MiB (the last may be smaller). */
export const UPLOAD_PART_BYTES = 10 * 1024 * 1024;
/** `R2Bucket.delete` takes at most this many keys per call. */
const DELETE_BATCH = 1000;

/** The file passed the byte cap while it streamed; nothing was stored. */
export class FileTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`File is larger than ${maxBytes} bytes`);
    this.name = "FileTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/** Collects stream chunks into fixed-size parts without copying more than needed. */
class PartBuffer {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.length += chunk.byteLength;
  }

  /** Removes and returns the first `size` bytes (all of them when `size` is omitted). */
  take(size = this.length): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = this.chunks[0];
      if (!chunk) {
        break;
      }
      const wanted = size - offset;
      if (chunk.byteLength <= wanted) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
        this.chunks.shift();
      } else {
        out.set(chunk.subarray(0, wanted), offset);
        this.chunks[0] = chunk.subarray(wanted);
        offset += wanted;
      }
    }
    this.length -= size;
    return out;
  }
}

/**
 * Writes `source` to `key`, at most `maxBytes`. Throws `FileTooLargeError` (and stores
 * nothing) as soon as the stream passes the cap; a failed multipart upload is aborted.
 * Returns the stored size.
 */
export async function writeObject(
  bucket: FileBucket,
  key: string,
  source: ReadableStream<Uint8Array>,
  options: { contentType: string; maxBytes: number; partBytes?: number },
): Promise<{ size: number }> {
  const partBytes = options.partBytes ?? UPLOAD_PART_BYTES;
  const httpMetadata = { contentType: options.contentType };
  const reader = source.getReader();
  const buffer = new PartBuffer();
  let total = 0;
  let upload: R2MultipartUpload | undefined;
  const parts: R2UploadedPart[] = [];

  try {
    while (true) {
      // Chunks arrive in order and parts are numbered in order: nothing to parallelise.
      // biome-ignore lint/performance/noAwaitInLoops: sequential stream read.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > options.maxBytes) {
        throw new FileTooLargeError(options.maxBytes);
      }
      buffer.push(value);
      while (buffer.length >= partBytes) {
        upload ??= await bucket.createMultipartUpload(key, { httpMetadata });
        parts.push(await upload.uploadPart(parts.length + 1, buffer.take(partBytes)));
      }
    }
    if (!upload) {
      const stored = await bucket.put(key, buffer.take(), { httpMetadata });
      return { size: storedSize(stored, total) };
    }
    if (buffer.length > 0) {
      parts.push(await upload.uploadPart(parts.length + 1, buffer.take()));
    }
    return { size: storedSize(await upload.complete(parts), total) };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await upload?.abort().catch(() => undefined);
    throw error;
  }
}

/** The size R2 reports, which must be the bytes counted while streaming. */
function storedSize(object: R2Object | null, counted: number): number {
  if (!object || object.size !== counted) {
    throw new Error(`R2 stored ${object?.size ?? "nothing"} bytes, expected ${counted}`);
  }
  return object.size;
}

/** Deletes `keys`, at most 1,000 per R2 call. */
export async function deleteKeys(bucket: FileBucket, keys: readonly string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    // biome-ignore lint/performance/noAwaitInLoops: R2 caps keys per call; batches are small.
    await bucket.delete(keys.slice(start, start + DELETE_BATCH));
  }
}

/** Deletes every object under `prefix`, following the listing's pages. */
export async function deletePrefix(bucket: FileBucket, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: each page needs the previous page's cursor.
    const page = await bucket.list({ prefix, cursor, limit: DELETE_BATCH });
    const keys = page.objects.map((object) => object.key);
    await deleteKeys(bucket, keys);
    deleted += keys.length;
    if (!page.truncated) {
      return deleted;
    }
    cursor = page.cursor;
  }
}

const encoder = new TextEncoder();

/**
 * Compares two strings in time that depends only on their lengths, for tokens. Node has
 * no `crypto.subtle.timingSafeEqual` (workerd does), so this is the plain XOR loop.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time comparison.
    diff |= (left[index] ?? 0) ^ (right[index % Math.max(right.length, 1)] ?? 0);
  }
  return diff === 0;
}

/** SHA-256 of `bytes` as lowercase hex. */
export async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let out = "";
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
