import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Message } from "@notifier/contract/message";
import { attachment } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { receiveUpload } from "../src/lib/file-routes";
import { handleMcpRequest } from "../src/mcp/handler";
import { createTestDb, TEST_FILES_ORIGIN, type TestDb } from "./db";
import { clientFor, seedUser, type TestUser } from "./helpers";

const MCP_URL = "http://localhost:3000/mcp";
const ATTACHMENT_ID = /^att_[0-9a-z]{26}$/u;
const UPLOAD_URL =
  /^https:\/\/notifier\.test\/api\/uploads\/(?<id>att_[0-9a-z]{26})\?token=(?<token>[0-9A-Za-z]{32})$/u;

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

type UploadLink = { attachmentId: string; uploadUrl: string; curl: string; expiresAt: string };

describe("MCP project and file tools", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let published: Message[];
  const clients: Client[] = [];

  async function connect(user: TestUser): Promise<Client> {
    const dispatch: Dispatch = {
      messagePublished: (item) => {
        published.push(item);
      },
      messagesRead: () => undefined,
    };
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (input, init) =>
        handleMcpRequest(
          new Request(input, init),
          { sub: user.id },
          {
            db: testDb.db,
            dispatch,
            files: testDb.files,
          },
        ),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  }

  function text(result: ToolResult): string {
    return result.content.map((part) => part.text ?? "").join("\n");
  }

  /** `curl -T` against the upload link: a PUT with the raw bytes and a Content-Length. */
  function put(uploadUrl: string, body: Uint8Array, contentLength = body.length) {
    const url = new URL(uploadUrl);
    return receiveUpload(
      testDb.db,
      testDb.files,
      new Request(url, {
        method: "PUT",
        headers: { "Content-Length": String(contentLength) },
        body,
      }),
      {
        attachmentId: url.pathname.split("/").at(-1) ?? "",
        token: url.searchParams.get("token") ?? "",
      },
    );
  }

  async function createUpload(client: Client, args: Record<string, unknown>) {
    const result = await call(client, "create_upload", args);
    if (result.isError) {
      throw new Error(`create_upload failed: ${text(result)}`);
    }
    return result.structuredContent as UploadLink;
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    published = [];
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await testDb.dispose();
  });

  it("creates a project with an icon and updates it as its owner only", async () => {
    const mcp = await connect(ada);
    const created = await call(mcp, "create_project", {
      name: "rezme",
      iconUrl: "https://example.com/rezme.png",
    });
    expect(created.structuredContent).toMatchObject({
      project: { name: "rezme", iconUrl: "https://example.com/rezme.png" },
    });
    const insecure = await call(mcp, "create_project", {
      name: "plain",
      iconUrl: "http://example.com/x.png",
    });
    expect(insecure.isError).toBe(true);

    const updated = await call(mcp, "update_project", {
      project: "rezme",
      displayName: "Rezme",
      iconUrl: null,
    });
    expect(updated.isError, text(updated)).toBeFalsy();
    expect(updated.structuredContent).toMatchObject({
      project: { name: "rezme", displayName: "Rezme", iconUrl: null },
    });

    const owner = clientFor(testDb.db, ada);
    const project = (await owner.projects.list()).find((item) => item.name === "rezme");
    await owner.members.add({ projectId: project?.id ?? "", email: bob.email, role: "publisher" });
    const denied = await call(await connect(bob), "update_project", {
      project: "rezme",
      description: "mine now",
    });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain("Only a project owner");
    expect((await owner.projects.get({ id: project?.id ?? "" })).description).toBeNull();
  });

  it("uploads through a link and attaches the file to send_notification", async () => {
    const mcp = await connect(ada);
    await call(mcp, "create_project", { name: "rezme" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
    const link = await createUpload(mcp, {
      project: "rezme",
      fileName: "screen.png",
      contentType: "image/png",
      size: png.length,
    });
    const match = UPLOAD_URL.exec(link.uploadUrl);
    expect(match?.groups?.id).toBe(link.attachmentId);
    expect(link.curl).toBe(`curl --fail-with-body -sS -T 'screen.png' '${link.uploadUrl}'`);
    expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(59 * 60 * 1000);

    // Not attachable before the upload.
    const early = await call(mcp, "send_notification", {
      project: "rezme",
      title: "Screenshot",
      attachmentId: link.attachmentId,
    });
    expect(early.isError).toBe(true);
    expect(text(early)).toContain("not been uploaded");

    const uploaded = await put(link.uploadUrl, png);
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ attachmentId: link.attachmentId, size: 10 });
    // Single use.
    expect((await put(link.uploadUrl, png)).status).toBe(404);

    const sent = await call(mcp, "send_notification", {
      project: "rezme",
      title: "Screenshot",
      attachmentId: link.attachmentId,
    });
    expect(sent.isError, text(sent)).toBeFalsy();
    expect(published[0]?.attachment).toMatchObject({
      id: link.attachmentId,
      name: "screen.png",
      kind: "image",
      size: 10,
    });
    expect(published[0]?.attachment?.url.startsWith(`${TEST_FILES_ORIGIN}/api/attachments/`)).toBe(
      true,
    );
  });

  it("defaults to General, enforces the declared size and expires the link", async () => {
    const mcp = await connect(ada);
    const general = await createUpload(mcp, {
      fileName: "notes.txt",
      contentType: "text/plain",
      size: 4,
    });
    expect(general.attachmentId).toMatch(ATTACHMENT_ID);
    // Declared too small: refused by Content-Length before reading.
    expect((await put(general.uploadUrl, new Uint8Array(5))).status).toBe(413);

    // Chunked bodies are counted while they stream.
    const counted = await createUpload(mcp, {
      fileName: "notes.txt",
      contentType: "text/plain",
      size: 4,
    });
    const url = new URL(counted.uploadUrl);
    const streamed = await receiveUpload(
      testDb.db,
      testDb.files,
      new Request(url, { method: "PUT", body: new Uint8Array(9) }),
      { attachmentId: counted.attachmentId, token: url.searchParams.get("token") ?? "" },
    );
    expect(streamed.status).toBe(413);
    expect((await testDb.files.bucket.list({ prefix: "attachments/" })).objects).toHaveLength(0);

    const late = await createUpload(mcp, {
      fileName: "late.txt",
      contentType: "text/plain",
      size: 1,
    });
    await testDb.db
      .update(attachment)
      .set({ uploadExpiresAt: new Date(Date.now() - 1) })
      .where(eq(attachment.id, late.attachmentId));
    expect((await put(late.uploadUrl, new Uint8Array(1))).status).toBe(404);

    const wrongToken = new URL(late.uploadUrl);
    wrongToken.searchParams.set("token", "x".repeat(32));
    expect((await put(wrongToken.toString(), new Uint8Array(1))).status).toBe(404);

    const tooBig = await call(mcp, "create_upload", {
      fileName: "huge.bin",
      contentType: "application/octet-stream",
      size: 200 * 1024 * 1024,
    });
    expect(tooBig.isError).toBe(true);
  });

  it("refuses uploads to projects the caller cannot publish to", async () => {
    const owner = clientFor(testDb.db, ada);
    const { id } = await owner.projects.create({ name: "team" });
    await owner.members.add({ projectId: id, email: bob.email, role: "subscriber" });
    const result = await call(await connect(bob), "create_upload", {
      project: "team",
      fileName: "a.txt",
      contentType: "text/plain",
      size: 1,
    });
    expect(result.isError).toBe(true);
    expect(await testDb.db.select().from(attachment)).toHaveLength(0);
  });
});
