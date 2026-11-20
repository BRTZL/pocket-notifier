import { message } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import {
  clientFor,
  codeError,
  definedError,
  nextMillisecond,
  seedUser,
  type TestUser,
} from "./helpers";

const RESPONSE_ID = /^rsp_/u;

describe("responses", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let cid: TestUser;
  let messageId: string;
  let topicId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    cid = await seedUser(testDb.db, "cid");
    const owner = clientFor(testDb.db, ada);
    ({ id: topicId } = await owner.topics.create({ name: "team" }));
    await owner.members.add({ topicId, email: bob.email, role: "subscriber" });
    ({ id: messageId } = await owner.messages.publish({
      topic: "team",
      actions: [
        { type: "reply", key: "yes", label: "Yes" },
        { type: "reply", key: "note", label: "Note", input: true },
        { type: "view", label: "Open", url: "https://example.com" },
      ],
    }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("records an ack and a text reply with the responder", async () => {
    const bobClient = clientFor(testDb.db, bob);
    const ack = await bobClient.responses.create({ messageId, actionKey: "yes" });
    expect(ack).toMatchObject({
      id: expect.stringMatching(RESPONSE_ID),
      messageId,
      actionKey: "yes",
      kind: "ack",
      text: null,
      user: { id: bob.id, name: bob.name, email: bob.email, image: null },
    });
    const text = await bobClient.responses.create({ messageId, actionKey: "note", text: "Later" });
    expect(text).toMatchObject({ kind: "text", text: "Later" });
  });

  it("requires text on an input action", async () => {
    const adaClient = clientFor(testDb.db, ada);
    await expect(
      adaClient.responses.create({ messageId, actionKey: "note" }),
    ).rejects.toMatchObject(codeError("BAD_REQUEST"));
    // Empty text fails the input schema before reaching the handler.
    await expect(
      adaClient.responses.create({ messageId, actionKey: "note", text: "" }),
    ).rejects.toMatchObject(codeError("BAD_REQUEST"));
  });

  it("rejects unknown and non-reply actions, and text on an ack action", async () => {
    const bobClient = clientFor(testDb.db, bob);
    const badRequest = codeError("BAD_REQUEST");
    await expect(
      bobClient.responses.create({ messageId, actionKey: "nope" }),
    ).rejects.toMatchObject(badRequest);
    // The view action got its index as key.
    await expect(bobClient.responses.create({ messageId, actionKey: "2" })).rejects.toMatchObject(
      badRequest,
    );
    await expect(
      bobClient.responses.create({ messageId, actionKey: "yes", text: "sure" }),
    ).rejects.toMatchObject(badRequest);
  });

  it("allows one response per user and action", async () => {
    const bobClient = clientFor(testDb.db, bob);
    await bobClient.responses.create({ messageId, actionKey: "yes" });
    await expect(bobClient.responses.create({ messageId, actionKey: "yes" })).rejects.toMatchObject(
      definedError("CONFLICT"),
    );
    await expect(
      clientFor(testDb.db, ada).responses.create({ messageId, actionKey: "yes" }),
    ).resolves.toMatchObject({ kind: "ack" });
  });

  it("is NOT_FOUND for non-members and expired messages", async () => {
    await expect(
      clientFor(testDb.db, cid).responses.create({ messageId, actionKey: "yes" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
    await testDb.db
      .update(message)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(message.id, messageId));
    await expect(
      clientFor(testDb.db, bob).responses.create({ messageId, actionKey: "yes" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
  });

  it("lists responses oldest first for owners and publishers", async () => {
    await clientFor(testDb.db, bob).responses.create({ messageId, actionKey: "yes" });
    await nextMillisecond();
    await clientFor(testDb.db, ada).responses.create({ messageId, actionKey: "yes" });

    const owner = clientFor(testDb.db, ada);
    const first = await owner.responses.list({ messageId, limit: 1 });
    expect(first.items.map((item) => item.user.id)).toEqual([bob.id]);
    const rest = await owner.responses.list({ messageId, cursor: first.nextCursor ?? "" });
    expect(rest).toMatchObject({ items: [{ user: { id: ada.id } }], nextCursor: null });

    await expect(clientFor(testDb.db, bob).responses.list({ messageId })).rejects.toMatchObject(
      definedError("FORBIDDEN"),
    );
    // Publishers can read responses too, not only owners.
    await owner.members.update({ topicId, userId: bob.id, role: "publisher" });
    await expect(clientFor(testDb.db, bob).responses.list({ messageId })).resolves.toMatchObject({
      items: [{ user: { id: bob.id } }, { user: { id: ada.id } }],
    });
    await expect(clientFor(testDb.db, cid).responses.list({ messageId })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
  });
});
