/**
 * A streaming `multipart/form-data` reader for file uploads: it finds one file field and
 * hands its bytes on as a stream, so a 95 MB upload never sits in memory whole (the
 * Workers `formData()` parser buffers the entire body).
 *
 * Other fields before the file are read and dropped (each at most `FIELD_MAX_BYTES`);
 * anything after the file is ignored.
 */

const CRLF = new Uint8Array([13, 10]);
const HEADER_END = new Uint8Array([13, 10, 13, 10]);
/** Largest header block of one part. */
const HEADERS_MAX_BYTES = 8 * 1024;
/** Largest non-file field we read past. */
const FIELD_MAX_BYTES = 8 * 1024;
const BOUNDARY = /boundary=(?:"(?<quoted>[^"]{1,70})"|(?<plain>[^\s;]{1,70}))/iu;
const MULTIPART = /^multipart\/form-data\s*(?:;|$)/iu;
const DISPOSITION_NAME = /(?:^|;)\s*name="(?<name>[^"]*)"/iu;
const DISPOSITION_FILENAME = /(?:^|;)\s*filename="(?<filename>[^"]*)"/iu;
const DISPOSITION_FILENAME_STAR = /(?:^|;)\s*filename\*=(?:UTF-8|utf-8)''(?<encoded>[^;\s]+)/u;

/** The body is not the multipart shape we accept; the message says why. */
export class MultipartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartError";
  }
}

/** The boundary of a `multipart/form-data` content type, or `null` for anything else. */
export function multipartBoundary(contentType: string | null): string | null {
  if (!(contentType && MULTIPART.test(contentType))) {
    return null;
  }
  const match = BOUNDARY.exec(contentType)?.groups;
  return match?.quoted ?? match?.plain ?? null;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  if (first === undefined) {
    return from;
  }
  let index = haystack.indexOf(first, from);
  while (index !== -1 && index + needle.length <= haystack.length) {
    let matched = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
    index = haystack.indexOf(first, index + 1);
  }
  return -1;
}

const DASH = 45;

type Found = { at: number } | { undecided: number } | null;

/**
 * Where `delimiter` is in `buffer`. With `boundary`, a match only counts when the two
 * bytes after it are CRLF (another part) or `--` (the end): the same bytes inside a
 * file are data. `undecided` is a match whose next two bytes have not arrived yet.
 */
function findDelimiter(buffer: Uint8Array, delimiter: Uint8Array, boundary: boolean): Found {
  let from = 0;
  while (true) {
    const at = indexOf(buffer, delimiter, from);
    if (at === -1) {
      return null;
    }
    if (!boundary) {
      return { at };
    }
    const first = buffer[at + delimiter.length];
    const second = buffer[at + delimiter.length + 1];
    if (first === undefined || second === undefined) {
      return { undecided: at };
    }
    if ((first === CRLF[0] && second === CRLF[1]) || (first === DASH && second === DASH)) {
      return { at };
    }
    from = at + 1;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) {
    return b;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const decoder = new TextDecoder();

export type MultipartFile = {
  /** `filename` from `Content-Disposition`, unsanitized; `""` when missing. */
  fileName: string;
  /** The part's `Content-Type`; `null` when it sent none. */
  contentType: string | null;
  /** The file bytes. Errors with `MultipartError` if the body ends before the part does. */
  stream: ReadableStream<Uint8Array>;
};

type PartHeaders = { name: string | null; fileName: string | null; contentType: string | null };

/** `filename*=UTF-8''...` when present and well-formed, else `filename="..."`. */
function dispositionFileName(value: string): string | null {
  const plain = DISPOSITION_FILENAME.exec(value)?.groups?.filename ?? null;
  const encoded = DISPOSITION_FILENAME_STAR.exec(value)?.groups?.encoded;
  if (!encoded) {
    return plain;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return plain;
  }
}

function parseHeaders(block: string): PartHeaders {
  const headers: PartHeaders = { name: null, fileName: null, contentType: null };
  for (const line of block.split("\r\n")) {
    const colon = line.indexOf(":");
    const key = colon === -1 ? "" : line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-type") {
      headers.contentType = value;
    } else if (key === "content-disposition") {
      headers.name = DISPOSITION_NAME.exec(value)?.groups?.name ?? null;
      headers.fileName = dispositionFileName(value);
    }
  }
  return headers;
}

/** Pull-based reader over the request body with a small look-ahead buffer. */
class Scanner {
  private buffer: Uint8Array = new Uint8Array(0);
  private ended = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  /** Reads one more chunk into the buffer; `false` at the end of the body. */
  async fill(): Promise<boolean> {
    if (this.ended) {
      return false;
    }
    const { done, value } = await this.reader.read();
    if (done) {
      this.ended = true;
      return false;
    }
    this.buffer = concat(this.buffer, value);
    return true;
  }

  consume(count: number): Uint8Array {
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  /**
   * Reads until `needle` (a full boundary when `boundary`), returning the at most
   * `maxBytes` bytes before it and dropping the needle itself.
   */
  async until(
    needle: Uint8Array,
    options: { maxBytes: number; what: string; boundary: boolean },
  ): Promise<Uint8Array> {
    const { maxBytes, what } = options;
    while (true) {
      const found = findDelimiter(this.buffer, needle, options.boundary);
      if (found && "at" in found) {
        if (found.at > maxBytes) {
          throw new MultipartError(`${what} is too long`);
        }
        const before = this.consume(found.at);
        this.consume(needle.length);
        return before;
      }
      if (this.buffer.length > maxBytes + needle.length + 2) {
        throw new MultipartError(`${what} is too long`);
      }
      // biome-ignore lint/performance/noAwaitInLoops: sequential stream read.
      if (!(await this.fill())) {
        throw new MultipartError(`The body ended inside ${what}`);
      }
    }
  }

  /** At least `count` bytes buffered, or the body ended. */
  async ensure(count: number): Promise<void> {
    while (this.buffer.length < count) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential stream read.
      if (!(await this.fill())) {
        return;
      }
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }

  /**
   * The next bytes of the current part: everything before `delimiter` once it is in
   * view (`last: true`), else everything except a possible partial delimiter at the end.
   * `null` when the body ends first.
   */
  async nextPartChunk(delimiter: Uint8Array): Promise<{ bytes: Uint8Array; last: boolean } | null> {
    while (true) {
      const found = findDelimiter(this.buffer, delimiter, true);
      if (found && "at" in found) {
        return { bytes: this.consume(found.at).slice(), last: true };
      }
      // Hold back an undecided match, or a possible partial delimiter at the end.
      const safe = found ? found.undecided : this.buffer.length - (delimiter.length - 1);
      if (safe > 0) {
        return { bytes: this.consume(safe).slice(), last: false };
      }
      // biome-ignore lint/performance/noAwaitInLoops: sequential stream read.
      if (!(await this.fill())) {
        return null;
      }
    }
  }
}

/**
 * Finds the form field `field` with a file in `body` and returns its bytes as a stream.
 * Throws `MultipartError` when the body has no such field or is not well-formed up to it.
 */
export async function readMultipartFile(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  field: string,
): Promise<MultipartFile> {
  const encoder = new TextEncoder();
  const opening = encoder.encode(`--${boundary}`);
  // Between parts the delimiter is preceded by a line break.
  const delimiter = encoder.encode(`\r\n--${boundary}`);
  const scanner = new Scanner(body);

  try {
    // The preamble (usually empty) runs up to the first delimiter.
    await scanner.until(opening, {
      maxBytes: HEADERS_MAX_BYTES,
      what: "the preamble",
      boundary: true,
    });
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: parts are read in order.
      await scanner.ensure(2);
      const after = scanner.consume(2);
      if (after[0] === DASH && after[1] === DASH) {
        throw new MultipartError(`No "${field}" file field in the form`);
      }
      if (!(after[0] === CRLF[0] && after[1] === CRLF[1])) {
        throw new MultipartError("Malformed multipart boundary line");
      }
      const headers = parseHeaders(
        decoder.decode(
          await scanner.until(HEADER_END, {
            maxBytes: HEADERS_MAX_BYTES,
            what: "part headers",
            boundary: false,
          }),
        ),
      );
      if (headers.name === field && headers.fileName !== null) {
        return {
          fileName: headers.fileName,
          contentType: headers.contentType,
          stream: partStream(scanner, delimiter),
        };
      }
      await scanner.until(delimiter, {
        maxBytes: FIELD_MAX_BYTES,
        what: `the field "${headers.name ?? ""}"`,
        boundary: true,
      });
    }
  } catch (error) {
    await scanner.cancel();
    throw error;
  }
}

/** The current part's bytes, up to (not including) the next delimiter. */
function partStream(scanner: Scanner, delimiter: Uint8Array): ReadableStream<Uint8Array> {
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        return;
      }
      const chunk = await scanner.nextPartChunk(delimiter);
      if (!chunk) {
        finished = true;
        controller.error(new MultipartError("The body ended inside the file"));
        return;
      }
      if (chunk.bytes.length > 0) {
        controller.enqueue(chunk.bytes);
      }
      if (chunk.last) {
        finished = true;
        controller.close();
        // The rest of the body (more fields, the closing delimiter) is not needed.
        await scanner.cancel();
      }
    },
    async cancel() {
      finished = true;
      await scanner.cancel();
    },
  });
}
