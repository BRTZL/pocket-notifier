import { InviteCode } from "@notifier/contract/invite";
import { invite } from "@notifier/db/schema/notifier";
import { sha256Hex } from "@notifier/db/secrets";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, seedUser, TEST_APP_URL, type TestUser } from "./helpers";

describe("invites", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let teamId: string;
  let opsId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    ({ id: teamId } = await owner.topics.create({ name: "team" }));
    ({ id: opsId } = await owner.topics.create({ name: "ops" }));
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("creates an invite with a hashed code and a configured URL", async () => {
    const client = clientFor(testDb.db, ada);
    const created = await client.invites.create({
      email: "New@Example.com",
      grants: [{ topicId: teamId, role: "publisher" }],
      expiresInDays: 3,
    });
    expect(InviteCode.safeParse(created.code).success).toBe(true);
    expect(created.url).toBe(`${TEST_APP_URL}/invite/${created.code}`);
    expect(created.invite).toMatchObject({
      email: "new@example.com",
      grants: [{ topicId: teamId, role: "publisher" }],
      createdBy: { id: ada.id, name: ada.name },
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
    });
    const expiresInMs = Date.parse(created.invite.expiresAt) - Date.now();
    expect(Math.round(expiresInMs / 86_400_000)).toBe(3);

    const [stored] = await testDb.db.select().from(invite).where(eq(invite.id, created.invite.id));
    expect(stored?.codeHash).toBe(await sha256Hex(created.code));
    expect(JSON.stringify(stored)).not.toContain(created.code);

    const defaults = await client.invites.create({});
    expect(defaults.invite.grants).toEqual([]);
    expect(Math.round((Date.parse(defaults.invite.expiresAt) - Date.now()) / 86_400_000)).toBe(7);
  });

  it("only grants topics the caller owns", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.members.add({ topicId: teamId, email: bob.email, role: "publisher" });
    const bobClient = clientFor(testDb.db, bob);
    await expect(
      bobClient.invites.create({ grants: [{ topicId: teamId, role: "subscriber" }] }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    await expect(
      bobClient.invites.create({ grants: [{ topicId: opsId, role: "subscriber" }] }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
  });

  it("rejects grants that list the same topic twice", async () => {
    await expect(
      clientFor(testDb.db, ada).invites.create({
        grants: [
          { topicId: teamId, role: "subscriber" },
          { topicId: teamId, role: "publisher" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: expect.stringContaining("only once"),
    });
    expect(await clientFor(testDb.db, ada).invites.list()).toEqual([]);
  });

  it("lists own invites newest first and revokes unaccepted ones", async () => {
    const client = clientFor(testDb.db, ada);
    const first = await client.invites.create({});
    const second = await client.invites.create({});
    await testDb.db
      .update(invite)
      .set({ createdAt: new Date(Date.now() + 1000) })
      .where(eq(invite.id, second.invite.id));
    await clientFor(testDb.db, bob).invites.create({});
    expect((await client.invites.list()).map((i) => i.id)).toEqual([
      second.invite.id,
      first.invite.id,
    ]);

    await expect(
      clientFor(testDb.db, bob).invites.revoke({ id: first.invite.id }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
    await expect(client.invites.revoke({ id: first.invite.id })).resolves.toEqual({ ok: true });
    await expect(client.invites.revoke({ id: first.invite.id })).resolves.toEqual({ ok: true });
    const revoked = (await client.invites.list()).find((i) => i.id === first.invite.id);
    expect(revoked?.revokedAt).not.toBeNull();

    await testDb.db
      .update(invite)
      .set({ acceptedAt: new Date(), acceptedBy: bob.id })
      .where(eq(invite.id, second.invite.id));
    await expect(client.invites.revoke({ id: second.invite.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    const accepted = (await client.invites.list()).find((i) => i.id === second.invite.id);
    expect(accepted?.acceptedBy).toMatchObject({ id: bob.id, email: bob.email });
  });

  it("previews an open invite without a session", async () => {
    const owner = clientFor(testDb.db, ada);
    const created = await owner.invites.create({
      email: "new@example.com",
      grants: [
        { topicId: teamId, role: "subscriber" },
        { topicId: opsId, role: "publisher" },
      ],
    });
    await owner.topics.delete({ id: opsId });

    const anonymous = clientFor(testDb.db, null);
    await expect(anonymous.invites.preview({ code: created.code })).resolves.toEqual({
      invitedBy: ada.name,
      email: "new@example.com",
      topics: ["team"],
      expiresAt: created.invite.expiresAt,
    });

    const notFound = definedError("NOT_FOUND");
    await expect(anonymous.invites.preview({ code: "A".repeat(24) })).rejects.toMatchObject(
      notFound,
    );

    const expired = await owner.invites.create({});
    await testDb.db
      .update(invite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invite.id, expired.invite.id));
    await expect(anonymous.invites.preview({ code: expired.code })).rejects.toMatchObject(notFound);

    await owner.invites.revoke({ id: created.invite.id });
    await expect(anonymous.invites.preview({ code: created.code })).rejects.toMatchObject(notFound);

    const accepted = await owner.invites.create({});
    await testDb.db
      .update(invite)
      .set({ acceptedAt: new Date(), acceptedBy: bob.id })
      .where(eq(invite.id, accepted.invite.id));
    await expect(anonymous.invites.preview({ code: accepted.code })).rejects.toMatchObject(
      notFound,
    );
  });

  it("requires a session for everything but preview", async () => {
    const anonymous = clientFor(testDb.db, null);
    await expect(anonymous.invites.list()).rejects.toMatchObject(definedError("UNAUTHORIZED"));
    await expect(anonymous.invites.create({})).rejects.toMatchObject(definedError("UNAUTHORIZED"));
  });
});
