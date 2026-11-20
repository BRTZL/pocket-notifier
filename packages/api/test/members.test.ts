import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, seedUser, type TestUser } from "./helpers";

const LAST_OWNER_MESSAGE = expect.stringContaining("at least one owner");

describe("members", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let topicId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    carol = await seedUser(testDb.db, "carol");
    ({ id: topicId } = await clientFor(testDb.db, ada).topics.create({ name: "team" }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("adds a member with a subscription and lists members", async () => {
    const owner = clientFor(testDb.db, ada);
    const added = await owner.members.add({
      topicId,
      email: "BOB@example.com",
      role: "subscriber",
    });
    expect(added).toMatchObject({
      topicId,
      role: "subscriber",
      user: { id: "bob", name: "User bob", email: "bob@example.com", image: null },
    });

    const bobClient = clientFor(testDb.db, bob);
    await expect(bobClient.topics.get({ id: topicId })).resolves.toMatchObject({
      role: "subscriber",
      subscribed: true,
      muted: false,
    });
    const members = await bobClient.members.list({ topicId });
    expect(members.map((m) => [m.user.id, m.role])).toEqual([
      ["ada", "owner"],
      ["bob", "subscriber"],
    ]);
    await expect(clientFor(testDb.db, carol).members.list({ topicId })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
  });

  it("rejects unknown emails, duplicates and non-owners", async () => {
    const owner = clientFor(testDb.db, ada);
    await expect(
      owner.members.add({ topicId, email: "nobody@example.com", role: "publisher" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
    await owner.members.add({ topicId, email: bob.email, role: "publisher" });
    await expect(
      owner.members.add({ topicId, email: bob.email, role: "subscriber" }),
    ).rejects.toMatchObject(definedError("CONFLICT"));
    await expect(
      clientFor(testDb.db, bob).members.add({ topicId, email: carol.email, role: "subscriber" }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
  });

  it("changes roles, but never demotes the last owner", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.members.add({ topicId, email: bob.email, role: "subscriber" });

    await expect(
      owner.members.update({ topicId, userId: ada.id, role: "publisher" }),
    ).rejects.toMatchObject({ ...definedError("FORBIDDEN"), message: LAST_OWNER_MESSAGE });
    await expect(
      clientFor(testDb.db, bob).members.update({ topicId, userId: bob.id, role: "owner" }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    await expect(
      owner.members.update({ topicId, userId: carol.id, role: "publisher" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));

    await expect(
      owner.members.update({ topicId, userId: bob.id, role: "owner" }),
    ).resolves.toMatchObject({ role: "owner", user: { id: "bob" } });
    // With two owners, one may step down.
    await expect(
      owner.members.update({ topicId, userId: ada.id, role: "publisher" }),
    ).resolves.toMatchObject({ role: "publisher" });
  });

  it("protects the last owner from removal and leaving", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.members.add({ topicId, email: bob.email, role: "publisher" });

    await expect(owner.members.remove({ topicId, userId: ada.id })).rejects.toMatchObject(
      definedError("FORBIDDEN"),
    );
    await expect(owner.topics.get({ id: topicId })).resolves.toMatchObject({
      role: "owner",
      subscribed: true,
    });

    await owner.members.update({ topicId, userId: bob.id, role: "owner" });
    await expect(owner.members.remove({ topicId, userId: ada.id })).resolves.toEqual({ ok: true });
    await expect(owner.topics.get({ id: topicId })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    await expect(
      clientFor(testDb.db, bob).members.remove({ topicId, userId: bob.id }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
  });

  it("lets owners remove members and members leave, dropping their subscription", async () => {
    const { db } = testDb;
    const owner = clientFor(db, ada);
    await owner.members.add({ topicId, email: bob.email, role: "publisher" });
    await owner.members.add({ topicId, email: carol.email, role: "subscriber" });

    // A non-owner cannot remove someone else.
    await expect(
      clientFor(db, bob).members.remove({ topicId, userId: carol.id }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));

    await expect(clientFor(db, bob).members.remove({ topicId, userId: bob.id })).resolves.toEqual({
      ok: true,
    });
    await expect(owner.members.remove({ topicId, userId: carol.id })).resolves.toEqual({
      ok: true,
    });
    await expect(owner.members.remove({ topicId, userId: carol.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );

    const subscriptions = await db.query.subscription.findMany({ where: { topicId } });
    expect(subscriptions.map((s) => s.userId)).toEqual(["ada"]);
    const members = await owner.members.list({ topicId });
    expect(members.map((m) => m.user.id)).toEqual(["ada"]);
  });
});
