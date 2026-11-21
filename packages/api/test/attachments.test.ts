import { ATTACHMENT_MAX_BYTES, UNUSED_UPLOAD_TTL_MS } from "@notifier/contract/message";
import { attachment } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { sanitizeFileName } from "../src/lib/attachments";
import { contentDisposition, parseRange, serveAttachment } from "../src/lib/file-routes";
import { FileTooLargeError, writeObject } from "../src/lib/files";
import { MultipartError, readMultipartFile } from "../src/lib/multipart";
import { createPublicHandler } from "../src/public/handler";
import { toPushData } from "../src/push/payload";
import { createTestDb, TEST_FILES_ORIGIN, type TestDb } from "./db";
import {
  clientFor,
  definedError,
  noopDispatch,
  publicClientFor,
  seedUser,
  type TestUser,
} from "./helpers";

const ATTACHMENT_ID = /^att_[0-9a-z]{26}$/u;
const INLINE_CLIP = /^inline; filename="clip.mp4"/u;
const CLIP_TOKEN = /\/[^/]+\/clip\.mp4$/u;
const AS_ATTACHMENT = /^attachment; /u;
const AS_INLINE = /^inline; /u;
const BOUNDARY = "----notifierTestBoundary7MA4YWxk";
const encoder = new TextEncoder();

/** `body` split into chunks of 1 to 7 bytes, so delimiters straddle reads. */
function trickle(body: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  let size = 1;
  return new ReadableStream({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      controller.enqueue(body.slice(offset, offset + size));
      offset += size;
      size = (size % 7) + 1;
    },
  });
}

function multipartBody(parts: { headers: string[]; data: Uint8Array | string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    chunks.push(encoder.encode(`--${BOUNDARY}\r\n${part.headers.join("\r\n")}\r\n\r\n`));
    chunks.push(typeof part.data === "string" ? encoder.encode(part.data) : part.data);
    chunks.push(encoder.encode("\r\n"));
  }
  chunks.push(encoder.encode(`--${BOUNDARY}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function filePart(name: string, data: Uint8Array | string, contentType?: string) {
  return {
    headers: [
      `Content-Disposition: form-data; name="file"; filename="${name}"`,
      ...(contentType ? [`Content-Type: ${contentType}`] : []),
    ],
    data,
  };
}

async function bytesOf(stream: ReadableStream<Uint8Array> | null | undefined) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Bytes that contain the boundary's first characters, CRLFs and every byte value. */
function awkwardBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (index * 31 + 7) % 256;
  }
  out.set(encoder.encode(`\r\n--${BOUNDARY.slice(0, 10)}`), Math.floor(length / 2));
  return out;
}

describe("readMultipartFile", () => {
  it("keeps boundary look-alikes inside the file as data", async () => {
    // The delimiter bytes followed by something other than CRLF or "--" are file data.
    const data = encoder.encode(
      `head\r\n--${BOUNDARY}xx middle \r\n--${BOUNDARY}\r\x00 \r\n--${BOUNDARY}- tail`,
    );
    for (const stream of [trickle, (bytes: Uint8Array) => new Blob([bytes]).stream()]) {
      const file = await readMultipartFile(
        stream(multipartBody([filePart("tricky.bin", data)])),
        BOUNDARY,
        "file",
      );
      expect(await bytesOf(file.stream)).toEqual(data);
    }
  });

  it("finds a closing boundary split across chunks", async () => {
    const data = encoder.encode("0123456789");
    const body = multipartBody([filePart("a.txt", data)]);
    // Split right inside "\r\n--<boundary>" and again before its trailing "--".
    const cut = body.length - BOUNDARY.length - 6;
    const chunks = [body.slice(0, cut), body.slice(cut, body.length - 4), body.slice(-4)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) {
          controller.enqueue(next);
        } else {
          controller.close();
        }
      },
    });
    const file = await readMultipartFile(stream, BOUNDARY, "file");
    expect(await bytesOf(file.stream)).toEqual(data);
  });

  it("refuses part headers over the limit even when they arrive in one chunk", async () => {
    const body = multipartBody([
      {
        headers: [
          `Content-Disposition: form-data; name="file"; filename="a.txt"`,
          `X-Padding: ${"a".repeat(9000)}`,
        ],
        data: "abc",
      },
    ]);
    await expect(readMultipartFile(new Blob([body]).stream(), BOUNDARY, "file")).rejects.toThrow(
      "part headers is too long",
    );
  });

  it("streams the file field across tiny chunks, skipping other fields", async () => {
    const data = awkwardBytes(5000);
    const body = multipartBody([
      { headers: ['Content-Disposition: form-data; name="note"'], data: "hello" },
      filePart("report.bin", data, "application/octet-stream"),
      { headers: ['Content-Disposition: form-data; name="after"'], data: "ignored" },
    ]);
    const file = await readMultipartFile(trickle(body), BOUNDARY, "file");
    expect(file.fileName).toBe("report.bin");
    expect(file.contentType).toBe("application/octet-stream");
    expect(await bytesOf(file.stream)).toEqual(data);
  });

  it("accepts a part without a Content-Type and an empty file", async () => {
    const file = await readMultipartFile(
      trickle(multipartBody([filePart("empty.txt", "")])),
      BOUNDARY,
      "file",
    );
    expect(file.contentType).toBeNull();
    expect(await bytesOf(file.stream)).toHaveLength(0);
  });

  it("rejects a form without the field and a body cut inside the file", async () => {
    const noFile = multipartBody([
      { headers: ['Content-Disposition: form-data; name="note"'], data: "hello" },
    ]);
    await expect(readMultipartFile(trickle(noFile), BOUNDARY, "file")).rejects.toBeInstanceOf(
      MultipartError,
    );
    const whole = multipartBody([filePart("a.txt", "abcdef")]);
    const cut = await readMultipartFile(trickle(whole.slice(0, -20)), BOUNDARY, "file");
    await expect(bytesOf(cut.stream)).rejects.toBeInstanceOf(MultipartError);
  });
});

describe("writeObject", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
  });
  afterEach(async () => {
    await testDb.dispose();
  });

  it("writes large files as an R2 multipart upload in equal parts", async () => {
    const data = awkwardBytes(5 * 1024 * 1024 * 2 + 123);
    const { size } = await writeObject(
      testDb.files.bucket,
      "attachments/x/big",
      trickleFast(data),
      {
        contentType: "video/mp4",
        maxBytes: ATTACHMENT_MAX_BYTES,
        partBytes: 5 * 1024 * 1024,
      },
    );
    expect(size).toBe(data.length);
    const stored = await testDb.files.bucket.get("attachments/x/big");
    expect(stored?.httpMetadata?.contentType).toBe("video/mp4");
    expect(await bytesOf(stored?.body)).toEqual(data);
  });

  it("stops at the byte cap and stores nothing", async () => {
    await expect(
      writeObject(testDb.files.bucket, "attachments/x/capped", trickleFast(new Uint8Array(101)), {
        contentType: "text/plain",
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await testDb.files.bucket.get("attachments/x/capped")).toBeNull();
  });
});

/** `data` in 64 KiB chunks. */
function trickleFast(data: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      controller.enqueue(data.slice(offset, offset + 65_536));
      offset += 65_536;
    },
  });
}

describe("helpers", () => {
  it("sanitizes file names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('C:\\Users\\a\\re"port\u0000.pdf')).toBe("re_port_.pdf");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("invoice\u202efdp.exe")).toBe("invoice_fdp.exe");
    expect(sanitizeFileName("a\u0085b\u2066c.txt")).toBe("a_b_c.txt");
    expect(sanitizeFileName("a".repeat(300))).toHaveLength(255);
  });

  it("parses single byte ranges", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-3", 10)).toEqual({ offset: 0, length: 4 });
    expect(parseRange("bytes=4-", 10)).toEqual({ offset: 4, length: 6 });
    expect(parseRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=5-100", 10)).toEqual({ offset: 5, length: 5 });
    expect(parseRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
  });

  it("builds a safe Content-Disposition", () => {
    expect(contentDisposition("attachment", "résumé.pdf")).toBe(
      "attachment; filename=\"r_sum_.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
    );
  });
});

describe("attachments", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let adaSecret: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    const { id: teamId } = await owner.projects.create({ name: "team" });
    await owner.projects.create({ name: "ops" });
    await owner.members.add({ projectId: teamId, email: bob.email, role: "subscriber" });
    ({ secret: adaSecret } = await owner.tokens.create({ name: "ci", scope: { kind: "all" } }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  function uploadRequest(project: string, body: Uint8Array, secret = adaSecret) {
    return new Request(`http://api.test/api/v1/projects/${project}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
        "Content-Length": String(body.length),
      },
      body,
    });
  }

  async function uploadOverHttp(project: string, body: Uint8Array, secret = adaSecret) {
    const handler = createPublicHandler();
    const request = uploadRequest(project, body, secret);
    const result = await handler.handle(request, {
      prefix: "/api",
      context: {
        db: testDb.db,
        authorization: request.headers.get("Authorization"),
        dispatch: noopDispatch,
        files: testDb.files,
      },
    });
    if (!result.matched) {
      throw new Error("upload route not matched");
    }
    return result.response;
  }

  async function download(url: string, headers: Record<string, string> = {}) {
    const parts = new URL(url).pathname.split("/");
    return await serveAttachment(testDb.db, testDb.files, new Request(url, { headers }), {
      attachmentId: parts[3] ?? "",
      token: parts[4] ?? "",
    });
  }

  it("uploads over REST, publishes with attachmentId and serves the file with ranges", async () => {
    const video = awkwardBytes(4096);
    const response = await uploadOverHttp(
      "team",
      multipartBody([filePart("clip.mp4", video, "video/mp4")]),
    );
    expect(response.status).toBe(201);
    const uploaded = (await response.json()) as { id: string; expiresAt: string };
    expect(uploaded.id).toMatch(ATTACHMENT_ID);

    const published: Parameters<Dispatch["messagePublished"]>[0][] = [];
    const api = publicClientFor(testDb.db, adaSecret, {
      ...noopDispatch,
      messagePublished: (item) => {
        published.push(item);
      },
    });
    const out = await api.messages.publish({
      project: "team",
      title: "Recording",
      attachmentId: uploaded.id,
    });
    const message = await api.messages.get({ id: out.id });
    expect(message.attachment).toMatchObject({
      id: uploaded.id,
      name: "clip.mp4",
      contentType: "video/mp4",
      size: video.length,
      kind: "video",
      expiresAt: out.expiresAt,
    });
    const url = message.attachment?.url ?? "";
    expect(url.startsWith(`${TEST_FILES_ORIGIN}/api/attachments/${uploaded.id}/`)).toBe(true);
    expect(published[0]?.attachment?.url).toBe(url);
    // The subscriber's inbox shows the same attachment.
    const inbox = await clientFor(testDb.db, bob).messages.get({ id: out.id });
    expect(inbox.attachment?.url).toBe(url);

    const whole = await download(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Type")).toBe("video/mp4");
    expect(whole.headers.get("Content-Length")).toBe(String(video.length));
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
    expect(whole.headers.get("Content-Disposition")).toMatch(INLINE_CLIP);
    expect(whole.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(whole.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(whole.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(await bytesOf(whole.body)).toEqual(video);

    const partial = await download(url, { Range: "bytes=100-199" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(`bytes 100-199/${video.length}`);
    expect(partial.headers.get("Content-Length")).toBe("100");
    expect(await bytesOf(partial.body)).toEqual(video.slice(100, 200));

    const past = await download(url, { Range: `bytes=${video.length}-` });
    expect(past.status).toBe(416);
    expect(past.headers.get("Content-Range")).toBe(`bytes */${video.length}`);

    const wrongToken = url.replace(CLIP_TOKEN, `/${"x".repeat(32)}/clip.mp4`);
    expect((await download(wrongToken)).status).toBe(404);
  });

  it("serves non-media files as downloads and images inline without the sandbox", async () => {
    const api = publicClientFor(testDb.db, adaSecret);
    const html = await api.attachments.upload({
      project: "team",
      file: new File(["<script>alert(1)</script>"], "page.html", { type: "text/html" }),
    });
    const png = await api.attachments.upload({
      project: "team",
      file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
        type: "image/png",
      }),
    });
    const first = await api.messages.publish({ project: "team", attachmentId: html.id });
    const second = await api.messages.publish({ project: "team", attachmentId: png.id });
    const htmlMessage = await api.messages.get({ id: first.id });
    const pngMessage = await api.messages.get({ id: second.id });
    expect(htmlMessage.attachment?.kind).toBe("file");
    expect(pngMessage.attachment?.kind).toBe("image");

    const htmlResponse = await download(htmlMessage.attachment?.url ?? "");
    expect(htmlResponse.headers.get("Content-Disposition")).toMatch(AS_ATTACHMENT);
    expect(htmlResponse.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    const pngResponse = await download(pngMessage.attachment?.url ?? "");
    expect(pngResponse.headers.get("Content-Disposition")).toMatch(AS_INLINE);
    expect(pngResponse.headers.get("Content-Security-Policy")).toBe("default-src 'none'");

    // Push: image attachments carry their URL for the big picture, others only the name.
    expect(toPushData(pngMessage)).toMatchObject({
      attachment: "shot.png",
      attachmentKind: "image",
      attachmentUrl: pngMessage.attachment?.url,
    });
    expect(toPushData(htmlMessage)).toMatchObject({
      attachment: "page.html",
      attachmentKind: "file",
      attachmentUrl: "",
    });
  });

  it("lets only one of two racing publishes attach an upload, leaving no extra message", async () => {
    const api = publicClientFor(testDb.db, adaSecret);
    const upload = await api.attachments.upload({
      project: "team",
      file: new File(["x"], "x.txt", { type: "text/plain" }),
    });
    const results = await Promise.allSettled(
      [0, 1].map(() => api.messages.publish({ project: "team", attachmentId: upload.id })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await api.messages.list({ project: "team" })).items).toHaveLength(1);
  });

  it("refuses an upload claimed by retention or uploaded by someone else", async () => {
    const api = publicClientFor(testDb.db, adaSecret);
    const upload = await api.attachments.upload({
      project: "team",
      file: new File(["x"], "x.txt", { type: "text/plain" }),
    });
    // Bob publishes to the project too, but did not upload the file.
    const owner = clientFor(testDb.db, ada);
    const [team] = (await owner.projects.list()).filter((item) => item.name === "team");
    await owner.members.update({ projectId: team?.id ?? "", userId: bob.id, role: "publisher" });
    await expect(
      clientFor(testDb.db, bob).messages.publish({ project: "team", attachmentId: upload.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Retention claims an expired upload by setting expires_at to 0; a publish that
    // passed the preflight just before must then write nothing.
    await testDb.db
      .update(attachment)
      .set({ expiresAt: new Date(0) })
      .where(eq(attachment.id, upload.id));
    await expect(
      api.messages.publish({ project: "team", attachmentId: upload.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await api.messages.list({ project: "team" })).items).toHaveLength(0);
  });

  it("attaches an upload once, only in its own project, and only once uploaded", async () => {
    const api = publicClientFor(testDb.db, adaSecret);
    const upload = await api.attachments.upload({
      project: "team",
      file: new File(["log"], "build.log", { type: "text/plain" }),
    });
    await expect(
      api.messages.publish({ project: "ops", attachmentId: upload.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("not found in this project"),
    });
    await api.messages.publish({ project: "team", attachmentId: upload.id });
    await expect(
      api.messages.publish({ project: "team", attachmentId: upload.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already attached"),
    });

    // An upload past its unused-upload expiry cannot be attached.
    const stale = await api.attachments.upload({
      project: "team",
      file: new File(["old"], "old.txt", { type: "text/plain" }),
    });
    await testDb.db
      .update(attachment)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(attachment.id, stale.id));
    await expect(
      api.messages.publish({ project: "team", attachmentId: stale.id }),
    ).rejects.toMatchObject({ message: expect.stringContaining("expired") });
  });

  it("attaches through the app API and deletes the file with its message", async () => {
    const upload = await publicClientFor(testDb.db, adaSecret).attachments.upload({
      project: "team",
      file: new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" }),
    });
    const app = clientFor(testDb.db, ada);
    const { id } = await app.messages.publish({ project: "team", attachmentId: upload.id });
    const shown = await app.messages.get({ id });
    expect(shown.attachment).toMatchObject({ kind: "pdf", name: "spec.pdf", size: 8 });
    const [row] = await testDb.db.select().from(attachment).where(eq(attachment.id, upload.id));
    expect(row?.expiresAt.toISOString()).toBe(shown.expiresAt);
    expect(await testDb.files.bucket.get(row?.r2Key ?? "")).not.toBeNull();

    await app.messages.delete({ id });
    expect(await testDb.files.bucket.get(row?.r2Key ?? "")).toBeNull();
    expect(await testDb.db.select().from(attachment)).toHaveLength(0);
  });

  it("rejects uploads without a publish token, over the cap, or without a file", async () => {
    const subscriberSecret = (
      await clientFor(testDb.db, bob).tokens.create({ name: "b", scope: { kind: "all" } })
    ).secret;
    const body = multipartBody([filePart("a.txt", "abc", "text/plain")]);
    expect((await uploadOverHttp("team", body, subscriberSecret)).status).toBe(403);
    expect((await uploadOverHttp("missing", body)).status).toBe(404);

    const handler = createPublicHandler();
    const huge = await handler.handle(
      new Request("http://api.test/api/v1/projects/team/attachments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adaSecret}`,
          "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
          "Content-Length": String(ATTACHMENT_MAX_BYTES + 1024 * 1024),
        },
        body: "x",
      }),
      {
        prefix: "/api",
        context: {
          db: testDb.db,
          authorization: `Bearer ${adaSecret}`,
          dispatch: noopDispatch,
          files: testDb.files,
        },
      },
    );
    expect(huge.response?.status).toBe(413);
    expect(await huge.response?.json()).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      data: { maxBytes: ATTACHMENT_MAX_BYTES },
    });

    const noFile = await uploadOverHttp(
      "team",
      multipartBody([{ headers: ['Content-Disposition: form-data; name="x"'], data: "1" }]),
    );
    expect(noFile.status).toBe(400);
    expect(await testDb.db.select().from(attachment)).toHaveLength(0);
  });

  it("gives the oRPC upload the contract's typed errors", async () => {
    await expect(
      publicClientFor(testDb.db, adaSecret).attachments.upload({
        project: "missing",
        file: new File(["a"], "a.txt"),
      }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
    const upload = await publicClientFor(testDb.db, adaSecret).attachments.upload({
      project: "team",
      file: new File(["a"], "a.txt"),
    });
    const [row] = await testDb.db.select().from(attachment).where(eq(attachment.id, upload.id));
    // Untyped files are stored as octet-stream; unused uploads expire after the TTL.
    expect(row?.contentType).toBe("application/octet-stream");
    expect((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBe(
      UNUSED_UPLOAD_TTL_MS,
    );
    vi.restoreAllMocks();
  });
});
