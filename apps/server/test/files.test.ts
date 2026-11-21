/**
 * The file routes through the real Hono app: project icons, the REST upload, attachment
 * downloads (with ranges) and MCP upload links. All public: no session lookup, any origin.
 */
import type { Context as ApiContext } from "@notifier/api/context";
import { createUploadLink } from "@notifier/api/lib/attachments";
import { project } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../packages/api/test/db";
import { clientFor, noopDispatch, seedUser } from "../../../packages/api/test/helpers";
import { createApp } from "../src/app";
import { ATTACHMENT_TOKEN_IN_PATH } from "../src/boundary";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const BOUNDARY = "xBoundaryx";
const LOG_DOWNLOAD = /^attachment; filename="log.txt"/u;
const LOG_TOKEN = /\/[^/]+\/log\.txt$/u;

describe("file routes", () => {
  let testDb: TestDb;
  let app: ReturnType<typeof createApp>;
  let secret: string;
  let projectId: string;
  const createContext = vi.fn(async () => ({}) as ApiContext);
  const identifyUser = vi.fn(async () => undefined);

  beforeAll(async () => {
    testDb = await createTestDb();
    const ada = await seedUser(testDb.db, "ada");
    const owner = clientFor(testDb.db, ada);
    ({ id: projectId } = await owner.projects.create({ name: "team" }));
    ({ secret } = await owner.tokens.create({ name: "ci", scope: { kind: "all" } }));
    await owner.projects.setIcon({
      id: projectId,
      contentType: "image/png",
      data: Buffer.from(PNG).toString("base64"),
    });
    app = createApp({
      appOrigin: "http://web.test",
      identifyUser,
      authHandler: async () => new Response(null, { status: 204 }),
      getDb: () => testDb.db,
      getFiles: () => testDb.files,
      createDispatch: async () => noopDispatch,
      createContext,
      oauthPages: {
        authOrigin: "http://localhost:3000",
        authHandler: async () => new Response(null, { status: 204 }),
        getSessionUser: async () => null,
        verifyOAuthQuery: async () => false,
        findClient: async () => null,
      },
      mcp: async () => new Response(null, { status: 401 }),
    });
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;

  it("serves an uploaded icon with long caching and public CORS, and 404s otherwise", async () => {
    const [row] = await testDb.db.select().from(project).where(eq(project.id, projectId));
    const response = await app.request(pathOf(row?.iconUrl ?? ""), {
      headers: { Origin: "https://elsewhere.example" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect((await app.request(`/api/icons/${projectId}/0000000000000000.png`)).status).toBe(404);
    expect((await app.request(`/api/icons/${projectId}/../secret`)).status).toBe(404);
  });

  it("uploads over REST, then downloads the attachment whole and by range", async () => {
    const data = new TextEncoder().encode("0123456789abcdef");
    const body = new TextEncoder().encode(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="log.txt"\r\nContent-Type: text/plain\r\n\r\n${new TextDecoder().decode(data)}\r\n--${BOUNDARY}--\r\n`,
    );
    const uploaded = await app.request("/api/v1/projects/team/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
        "Content-Length": String(body.length),
      },
      body,
    });
    expect(uploaded.status).toBe(201);
    const { id: attachmentId } = (await uploaded.json()) as { id: string };

    const published = await app.request("/api/v1/projects/team/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Log", attachmentId }),
    });
    expect(published.status).toBe(201);
    const { id: messageId } = (await published.json()) as { id: string };
    const message = (await (
      await app.request(`/api/v1/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${secret}` },
      })
    ).json()) as { attachment: { url: string; kind: string } };
    expect(message.attachment.kind).toBe("file");

    const whole = await app.request(pathOf(message.attachment.url));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Disposition")).toMatch(LOG_DOWNLOAD);
    expect(await whole.text()).toBe("0123456789abcdef");

    const range = await app.request(pathOf(message.attachment.url), {
      headers: { Range: "bytes=-4" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe("bytes 12-15/16");
    expect(await range.text()).toBe("cdef");

    const head = await app.request(pathOf(message.attachment.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("16");

    const wrong = message.attachment.url.replace(LOG_TOKEN, `/${"A".repeat(32)}/log.txt`);
    expect((await app.request(pathOf(wrong))).status).toBe(404);
  });

  it("takes an upload link's PUT once", async () => {
    const link = await createUploadLink(testDb.db, testDb.files, {
      projectId,
      userId: "ada",
      fileName: "a.bin",
      contentType: "application/octet-stream",
      size: 3,
    });
    const put = () =>
      app.request(pathOf(link.url), {
        method: "PUT",
        headers: { "Content-Length": "3" },
        body: new Uint8Array([1, 2, 3]),
      });
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(404);
    const preflight = await app.request(pathOf(link.url), {
      method: "OPTIONS",
      headers: { Origin: "https://x.example", "Access-Control-Request-Method": "PUT" },
    });
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });

  it("never looks up a session for file routes", () => {
    expect(createContext).not.toHaveBeenCalled();
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it("redacts the download token from logged paths", () => {
    const path = `/api/attachments/att_${"a".repeat(26)}/SECRETtoken123/report.pdf`;
    expect(path.replace(ATTACHMENT_TOKEN_IN_PATH, "[REDACTED]")).toBe(
      `/api/attachments/att_${"a".repeat(26)}/[REDACTED]/report.pdf`,
    );
  });
});
