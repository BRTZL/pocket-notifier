import { message } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "../src/dispatch";
import { createPublicHandler } from "../src/public/handler";
import { createTestDb, type TestDb } from "./db";
import {
  clientFor,
  codeError,
  definedError,
  nextMillisecond,
  noopDispatch,
  publicClientFor,
  seedUser,
  type TestUser,
} from "./helpers";

const MESSAGE_ID = /^msg_/u;

describe("public messages API", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let teamId: string;
  let adaSecret: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    ({ id: teamId } = await owner.projects.create({ name: "team", defaultPriority: 4 }));
    await owner.projects.create({ name: "ops" });
    ({ secret: adaSecret } = await owner.tokens.create({ name: "ci", scope: { kind: "all" } }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  async function tokenFor(testUser: TestUser, projects?: string[]) {
    const { secret } = await clientFor(testDb.db, testUser).tokens.create({
      name: "t",
      scope: projects ? { kind: "projects", projects } : { kind: "all" },
    });
    return secret;
  }

  describe("publish", () => {
    it("stores the message with project defaults and keyed actions", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const out = await api.messages.publish({
        project: "team",
        title: "Deploy?",
        actions: [
          { type: "reply", key: "yes", label: "Deploy" },
          { type: "view", label: "Open", url: "https://example.com/run/1" },
        ],
        conversation: { id: "notifier" },
        sender: { id: "claude", name: "Claude" },
      });
      expect(out.project).toBe("team");
      // 30 days is the default retention.
      expect(Date.parse(out.expiresAt) - Date.parse(out.createdAt)).toBe(30 * 86_400_000);

      const stored = await api.messages.get({ id: out.id });
      expect(stored).toMatchObject({
        id: out.id,
        projectId: teamId,
        project: "team",
        title: "Deploy?",
        body: "",
        priority: 4,
        tags: [],
        clickUrl: null,
        attachment: null,
        conversation: { id: "notifier" },
        sender: { id: "claude", name: "Claude" },
        publishedBy: { id: ada.id, email: ada.email },
        createdAt: out.createdAt,
        expiresAt: out.expiresAt,
      });
      expect(stored.actions).toEqual([
        { type: "reply", key: "yes", label: "Deploy", clear: false, input: false },
        { type: "view", key: "1", label: "Open", url: "https://example.com/run/1", clear: false },
      ]);

      const [row] = await testDb.db.select().from(message).where(eq(message.id, out.id));
      expect(row).toMatchObject({ priority: 4, publishedBy: ada.id, tokenId: expect.any(String) });
    });

    it("uses an explicit priority over the project default", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const out = await api.messages.publish({ project: "team", body: "x", priority: 1 });
      expect((await api.messages.get({ id: out.id })).priority).toBe(1);
    });

    it("rejects duplicate action keys, including a key that collides with an index", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const view = { type: "view" as const, label: "Open", url: "https://example.com" };
      await expect(
        api.messages.publish({
          project: "team",
          actions: [
            { ...view, key: "a" },
            { ...view, key: "a" },
          ],
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
      await expect(
        api.messages.publish({ project: "team", actions: [{ ...view, key: "1" }, view] }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
      expect(await testDb.db.$count(message)).toBe(0);
    });

    it("caps URL lengths", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const long = `https://example.com/${"a".repeat(2048)}`;
      await expect(api.messages.publish({ project: "team", clickUrl: long })).rejects.toMatchObject(
        codeError("BAD_REQUEST"),
      );
      await expect(
        api.messages.publish({
          project: "team",
          actions: [{ type: "view", label: "Open", url: long }],
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
      await expect(
        api.messages.publish({
          project: "team",
          actions: [{ type: "http", label: "Go", url: long }],
        }),
      ).rejects.toMatchObject(codeError("BAD_REQUEST"));
    });

    it("only accepts http(s) and notifier: links", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      for (const url of ["javascript:alert(1)", "intent://x#Intent;end", "file:///etc/hosts"]) {
        // biome-ignore lint/performance/noAwaitInLoops: each case must fail on its own.
        await expect(
          api.messages.publish({ project: "team", clickUrl: url }),
        ).rejects.toMatchObject(codeError("BAD_REQUEST"));
        await expect(
          api.messages.publish({
            project: "team",
            actions: [{ type: "view", label: "Open", url }],
          }),
        ).rejects.toMatchObject(codeError("BAD_REQUEST"));
      }
      await expect(
        api.messages.publish({
          project: "team",
          clickUrl: "notifier://project/x",
          actions: [{ type: "view", label: "Open", url: "http://example.com" }],
        }),
      ).resolves.toMatchObject({ project: "team" });
    });

    it("rejects attachments until they are supported", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      await expect(
        api.messages.publish({ project: "team", attachmentId: "att_01jd8x7q3n1p5s8u0w2y4a6c8e" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Attachments are not supported yet",
      });
    });

    it("rejects unknown projects, out-of-scope projects and subscriber tokens", async () => {
      const scoped = publicClientFor(testDb.db, await tokenFor(ada, ["team"]));
      await expect(scoped.messages.publish({ project: "missing" })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
      await expect(scoped.messages.publish({ project: "ops" })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );

      const owner = clientFor(testDb.db, ada);
      await owner.members.add({ projectId: teamId, email: bob.email, role: "publisher" });
      const bobApi = publicClientFor(testDb.db, await tokenFor(bob, ["team"]));
      await owner.members.update({ projectId: teamId, userId: bob.id, role: "subscriber" });
      await expect(bobApi.messages.publish({ project: "team" })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );
    });

    it("hands the stored message to dispatch once", async () => {
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      const api = publicClientFor(testDb.db, adaSecret, { ...noopDispatch, messagePublished });
      const out = await api.messages.publish({ project: "team", body: "hello", tags: ["ci"] });
      expect(messagePublished).toHaveBeenCalledTimes(1);
      expect(messagePublished).toHaveBeenCalledWith(await api.messages.get({ id: out.id }));
    });

    it("still succeeds when dispatch throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const api = publicClientFor(testDb.db, adaSecret, {
        ...noopDispatch,
        messagePublished: () => {
          throw new Error("push down");
        },
      });
      await expect(api.messages.publish({ project: "team" })).resolves.toMatchObject({
        project: "team",
      });
      spy.mockRestore();
    });
  });

  describe("list", () => {
    it("pages newest first, skips expired messages and filters by since", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push((await api.messages.publish({ project: "team", body: `m${index}` })).id);
        await nextMillisecond();
      }
      await api.messages.publish({ project: "ops", body: "other project" });
      const [, expiredId] = ids;
      await testDb.db
        .update(message)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(message.id, expiredId ?? ""));
      const visible = ids.filter((id) => id !== expiredId).reverse();

      const first = await api.messages.list({ project: "team", limit: 2 });
      expect(first.items.map((item) => item.id)).toEqual(visible.slice(0, 2));
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await api.messages.list({
        project: "team",
        limit: 2,
        cursor: first.nextCursor ?? "",
      });
      expect(second.items.map((item) => item.id)).toEqual(visible.slice(2, 4));
      expect(second.nextCursor).toBeNull();

      const third = (await api.messages.get({ id: ids[2] ?? "" })).createdAt;
      const since = await api.messages.list({ project: "team", since: third });
      expect(since.items.map((item) => item.body)).toEqual(["m4", "m3"]);

      await expect(api.messages.list({ project: "team", cursor: "nope" })).rejects.toMatchObject(
        codeError("BAD_REQUEST"),
      );
    });

    it("needs the project in scope", async () => {
      const scoped = publicClientFor(testDb.db, await tokenFor(ada, ["ops"]));
      await expect(scoped.messages.list({ project: "team" })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );
      await expect(scoped.messages.list({ project: "missing" })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
    });
  });

  describe("get", () => {
    it("is NOT_FOUND for missing, expired, out-of-scope and non-member messages", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const notFound = definedError("NOT_FOUND");
      const { id } = await api.messages.publish({ project: "team" });

      await expect(
        api.messages.get({ id: "msg_01jd8x5k2m9q7r4t6v8w0y3z5a" }),
      ).rejects.toMatchObject(notFound);
      const outOfScope = publicClientFor(testDb.db, await tokenFor(ada, ["ops"]));
      await expect(outOfScope.messages.get({ id })).rejects.toMatchObject(notFound);
      const stranger = publicClientFor(testDb.db, await tokenFor(bob));
      await expect(stranger.messages.get({ id })).rejects.toMatchObject(notFound);

      await testDb.db
        .update(message)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(message.id, id));
      await expect(api.messages.get({ id })).rejects.toMatchObject(notFound);
    });
  });

  describe("responses", () => {
    it("lists responses oldest first for owners and publishers only", async () => {
      const api = publicClientFor(testDb.db, adaSecret);
      const owner = clientFor(testDb.db, ada);
      await owner.members.add({ projectId: teamId, email: bob.email, role: "publisher" });
      // Tokens need a publishing role when created; Bob is demoted to subscriber after.
      const bobApi = publicClientFor(testDb.db, await tokenFor(bob, ["team"]));
      await owner.members.update({ projectId: teamId, userId: bob.id, role: "subscriber" });
      const { id } = await api.messages.publish({
        project: "team",
        actions: [
          { type: "reply", key: "yes", label: "Yes" },
          { type: "reply", key: "note", label: "Note", input: true },
        ],
      });
      await clientFor(testDb.db, bob).responses.create({ messageId: id, actionKey: "yes" });
      await nextMillisecond();
      await owner.responses.create({ messageId: id, actionKey: "note", text: "later" });

      const page = await api.messages.responses({ id, limit: 1 });
      expect(page.items).toEqual([
        expect.objectContaining({
          actionKey: "yes",
          kind: "ack",
          text: null,
          user: expect.objectContaining({ id: bob.id }),
        }),
      ]);
      const rest = await api.messages.responses({ id, cursor: page.nextCursor ?? "" });
      expect(rest).toEqual({
        items: [expect.objectContaining({ actionKey: "note", kind: "text", text: "later" })],
        nextCursor: null,
      });

      // Bob can read the project but is a subscriber.
      await expect(bobApi.messages.responses({ id })).rejects.toMatchObject(
        definedError("FORBIDDEN"),
      );
      // As a publisher, Bob's token can read them.
      await owner.members.update({ projectId: teamId, userId: bob.id, role: "publisher" });
      await expect(bobApi.messages.responses({ id })).resolves.toMatchObject({
        items: [{ actionKey: "yes" }, { actionKey: "note" }],
      });
      const outOfScope = publicClientFor(testDb.db, await tokenFor(ada, ["ops"]));
      await expect(outOfScope.messages.responses({ id })).rejects.toMatchObject(
        definedError("NOT_FOUND"),
      );
    });
  });

  describe("over HTTP", () => {
    it("serves POST /v1/projects/{project}/messages with 201 and typed errors", async () => {
      const handler = createPublicHandler();
      const messagePublished = vi.fn<Dispatch["messagePublished"]>();
      const send = (request: Request) =>
        handler.handle(request, {
          context: {
            db: testDb.db,
            authorization: request.headers.get("Authorization"),
            dispatch: { ...noopDispatch, messagePublished },
          },
        });

      const created = await send(
        new Request("http://api.test/v1/projects/team/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${adaSecret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ body: "Nightly backup finished", tags: ["backup"] }),
        }),
      );
      expect(created.matched).toBe(true);
      expect(created.response?.status).toBe(201);
      const body = (await created.response?.json()) as { id: string; project: string };
      expect(body).toMatchObject({ id: expect.stringMatching(MESSAGE_ID), project: "team" });
      expect(messagePublished).toHaveBeenCalledTimes(1);

      const listed = await send(
        new Request("http://api.test/v1/projects/team/messages?limit=1", {
          headers: { Authorization: `Bearer ${adaSecret}` },
        }),
      );
      expect(listed.response?.status).toBe(200);
      expect(await listed.response?.json()).toMatchObject({
        items: [{ id: body.id, body: "Nightly backup finished", priority: 4 }],
        nextCursor: null,
      });

      const unauthorized = await send(
        new Request("http://api.test/v1/projects/team/messages", { method: "POST", body: "{}" }),
      );
      expect(unauthorized.response?.status).toBe(401);

      const unknown = await send(
        new Request("http://api.test/v1/projects/nope/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${adaSecret}`, "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(unknown.response?.status).toBe(404);

      const tooLarge = await send(
        new Request("http://api.test/v1/projects/team/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${adaSecret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ body: "x".repeat(70_000) }),
        }),
      );
      expect(tooLarge.response?.status).toBe(413);
      expect(await tooLarge.response?.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
      expect(messagePublished).toHaveBeenCalledTimes(1);

      const attachment = await send(
        new Request("http://api.test/v1/projects/team/attachments", {
          method: "POST",
          headers: { Authorization: `Bearer ${adaSecret}` },
        }),
      );
      expect(attachment.matched).toBe(false);
    });
  });
});
