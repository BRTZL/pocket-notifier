import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Message } from "@notifier/contract/message";
import { message, project } from "@notifier/db/schema/notifier";
import { oauthClient } from "@notifier/db/schema/oauth";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { handleMcpRequest, type McpTokenClaims } from "../src/mcp/handler";
import { createTestDb, type TestDb } from "./db";
import { clientFor, nextMillisecond, publicClientFor, seedUser, type TestUser } from "./helpers";

const MCP_URL = "http://localhost:3000/mcp";
const CLIENT_ID = "testClientIdtestClientIdtestClie";

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

describe("MCP server", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let published: Message[];
  let mcp: Client;

  async function connect(claims: McpTokenClaims): Promise<Client> {
    const dispatch: Dispatch = {
      messagePublished: (item) => {
        published.push(item);
      },
      messagesRead: () => undefined,
    };
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (input, init) =>
        handleMcpRequest(new Request(input, init), claims, {
          db: testDb.db,
          dispatch,
          files: testDb.files,
        }),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    return (await mcp.callTool({ name, arguments: args })) as ToolResult;
  }

  function text(result: ToolResult): string {
    return result.content.map((part) => part.text ?? "").join("\n");
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    published = [];
    await testDb.db.insert(oauthClient).values({
      id: "oac_1",
      clientId: CLIENT_ID,
      name: "Test Client",
      redirectUris: ["http://127.0.0.1:33418/callback"],
    });
    mcp = await connect({ sub: ada.id, azp: CLIENT_ID });
  });

  afterEach(async () => {
    await mcp.close();
    await testDb.dispose();
  });

  it("lists the tools with instructions", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_feature",
      "create_project",
      "create_upload",
      "list_features",
      "list_projects",
      "send_notification",
      "update_feature_status",
      "update_project",
    ]);
    const send = tools.find((tool) => tool.name === "send_notification");
    expect(send?.inputSchema).toMatchObject({
      type: "object",
      required: ["title"],
      properties: { project: { type: "string" }, priority: { type: "integer" } },
    });
    expect(mcp.getInstructions()).toContain("Pocket Notifier");
  });

  it("creates projects and features idempotently and lists them", async () => {
    const created = await call("create_project", { name: "rezme", displayName: "Rezme" });
    expect(created.isError).toBeUndefined();
    expect(created.structuredContent).toMatchObject({ created: true, project: { name: "rezme" } });
    const again = await call("create_project", { name: "rezme" });
    expect(again.structuredContent).toMatchObject({ created: false });

    const feature = await call("create_feature", {
      project: "rezme",
      name: "Improving performance",
    });
    expect(feature.structuredContent).toMatchObject({
      created: true,
      feature: { slug: "improving-performance", status: "active" },
    });
    await call("create_feature", { project: "rezme", name: "Improving Performance" });

    const listed = await call("list_features", { project: "rezme" });
    expect(listed.structuredContent).toMatchObject({
      features: [{ slug: "improving-performance" }],
    });
    const projects = await call("list_projects");
    expect(projects.structuredContent).toMatchObject({
      projects: [
        expect.objectContaining({ isGeneral: true, displayName: "General" }),
        expect.objectContaining({
          name: "rezme",
          role: "owner",
          isGeneral: false,
          features: { active: 1, done: 0, archived: 0 },
        }),
      ],
    });

    const done = await call("update_feature_status", {
      project: "rezme",
      feature: "Improving performance",
      status: "done",
    });
    expect(text(done)).toBe("Feature improving-performance is now done.");
    await expect(call("list_features", { project: "rezme" })).resolves.toMatchObject({
      structuredContent: { features: [] },
    });
  });

  it("returns readable errors for agents", async () => {
    const missing = await call("list_features", { project: "nope" });
    expect(missing).toMatchObject({ isError: true });
    expect(text(missing)).toBe(
      "Project 'nope' not found. Call list_projects to see your projects, or create_project to add it.",
    );
    const noFeature = await call("update_feature_status", {
      project: "general",
      feature: "ghost",
      status: "done",
    });
    expect(text(noFeature)).toContain("Feature 'ghost' not found");

    await seedUser(testDb.db, "bob");
    await clientFor(testDb.db, {
      id: "bob",
      name: "Bob",
      email: "bob@example.com",
    }).projects.create({
      name: "taken",
    });
    const taken = await call("create_project", { name: "taken" });
    expect(text(taken)).toBe("The project name 'taken' is taken. Pick another name.");

    const invalid = await call("send_notification", { title: "" });
    expect(invalid.isError).toBe(true);
  });

  it("sends a notification into a new feature with the client as sender", async () => {
    await call("create_project", { name: "rezme" });
    const sent = await call("send_notification", {
      project: "rezme",
      feature: "Dark mode",
      title: "Dark mode done",
      body: "All screens pass. Review PR #12.",
      priority: 3,
      url: "https://example.com/pr/12",
      ask: { question: "Merge now?", quickReplies: ["Merge", "Wait"] },
      actions: [{ label: "Open PR", url: "https://example.com/pr/12" }],
    });
    expect(sent.isError).toBeUndefined();
    expect(sent.structuredContent).toMatchObject({
      project: "rezme",
      isGeneral: false,
      feature: { slug: "dark-mode", name: "Dark mode", created: true },
      deliveredTo: 0,
    });
    expect(text(sent)).toContain("(new feature)");

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      project: "rezme",
      title: "Dark mode done",
      body: "All screens pass. Review PR #12.\n\nMerge now?",
      conversation: { id: "dark-mode", title: "Dark mode" },
      sender: { id: CLIENT_ID, name: "Test Client" },
      publishedBy: { id: ada.id },
      actions: [{ type: "view", label: "Open PR" }],
    });
    // quickReplies are accepted but no reply action is sent: agents cannot read replies.
    expect(published[0]?.actions).toHaveLength(1);
  });

  it("files MCP and REST sends to the same feature under the same key", async () => {
    await call("create_project", { name: "rezme" });
    const owner = clientFor(testDb.db, ada);
    const { secret } = await owner.tokens.create({ name: "ci", scope: { kind: "all" } });
    const api = publicClientFor(testDb.db, secret);

    const viaMcp = await call("send_notification", {
      project: "rezme",
      feature: "Improving performance",
      title: "Profiled",
    });
    expect(viaMcp.structuredContent).toMatchObject({
      feature: { slug: "improving-performance", created: true },
    });
    const viaRest = await api.messages.publish({
      project: "rezme",
      conversation: { id: "improving-performance" },
    });
    // REST first, then MCP by the slug-of-text rule: still one feature.
    const restFirst = await api.messages.publish({
      project: "rezme",
      conversation: { id: "org/repo" },
    });
    await nextMillisecond();
    const back = await call("send_notification", {
      project: "rezme",
      feature: "org/repo",
      title: "Merged",
    });
    expect(back.structuredContent).toMatchObject({
      feature: { slug: "org-repo", created: false },
    });

    const keyOf = new Map(
      (await testDb.db.select({ id: message.id, key: message.conversationKey }).from(message)).map(
        (row) => [row.id, row.key],
      ),
    );
    expect(keyOf.get(String(viaMcp.structuredContent?.messageId))).toBe("c:improving-performance");
    expect(keyOf.get(viaRest.id)).toBe("c:improving-performance");
    expect(keyOf.get(restFirst.id)).toBe("c:org-repo");
    expect(keyOf.get(String(back.structuredContent?.messageId))).toBe("c:org-repo");
    const [{ id: projectId } = { id: "" }] = await testDb.db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.name, "rezme"));
    const features = await owner.features.list({ projectId });
    expect(features.map((item) => item.slug)).toEqual(["org-repo", "improving-performance"]);
  });

  it("sends to General when no project is given", async () => {
    const sent = await call("send_notification", { title: "Hello" });
    expect(sent.structuredContent).toMatchObject({ isGeneral: true, feature: null });
    const [stored] = await testDb.db
      .select({ projectId: message.projectId, personal: project.personalUserId })
      .from(message)
      .innerJoin(project, eq(project.id, message.projectId));
    expect(stored?.personal).toBe(ada.id);
  });

  it("falls back to the agent sender without a client id", async () => {
    const anonymous = await connect({ sub: ada.id });
    try {
      await anonymous.callTool({ name: "send_notification", arguments: { title: "Hi" } });
      expect(published[0]?.sender).toEqual({ id: "agent" });
    } finally {
      await anonymous.close();
    }
  });

  it("answers GET with 405 and refuses tokens without a subject", async () => {
    const dispatch = { messagePublished: () => undefined, messagesRead: () => undefined };
    const get = await handleMcpRequest(
      new Request(MCP_URL, { headers: { accept: "text/event-stream" } }),
      { sub: ada.id },
      { db: testDb.db, dispatch, files: testDb.files },
    );
    expect(get.status).toBe(405);
    const anonymous = await handleMcpRequest(
      new Request(MCP_URL, { method: "POST", body: "{}" }),
      {},
      { db: testDb.db, dispatch, files: testDb.files },
    );
    expect(anonymous.status).toBe(401);
  });
});
