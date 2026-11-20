import { createAuth } from "@notifier/auth";
import { consumeInvite } from "@notifier/auth/invites";
import { user } from "@notifier/db/schema/auth";
import { invite, subscription, topicMember } from "@notifier/db/schema/notifier";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, seedUser, type TestUser } from "./helpers";

const ENV = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  CORS_ORIGIN: "http://web.test",
};

const PASSWORD = "correct horse battery";

describe("invite-only sign-up", () => {
  let testDb: TestDb;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    testDb = await createTestDb();
    auth = createAuth(ENV, testDb.db);
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  function signUp(email: string, inviteCode?: unknown) {
    return auth.api.signUpEmail({
      body: {
        name: email.split("@")[0] ?? email,
        email,
        password: PASSWORD,
        ...(inviteCode === undefined ? {} : { inviteCode }),
      },
    });
  }

  const forbidden = { statusCode: 403 };

  async function bootstrapOwner(): Promise<TestUser> {
    const { user: created } = await signUp("owner@example.com");
    return { id: created.id, name: created.name, email: created.email };
  }

  async function userCount() {
    return await testDb.db.$count(user);
  }

  it("lets the first account in without an invite, and nobody after that", async () => {
    const owner = await bootstrapOwner();
    expect(owner.email).toBe("owner@example.com");

    await expect(signUp("second@example.com")).rejects.toMatchObject({
      ...forbidden,
      message: expect.stringContaining("invite"),
    });
    await expect(signUp("second@example.com", "not-a-code")).rejects.toMatchObject(forbidden);
    await expect(signUp("second@example.com", "A".repeat(24))).rejects.toMatchObject(forbidden);
    await expect(signUp("second@example.com", 42)).rejects.toMatchObject(forbidden);
    expect(await userCount()).toBe(1);
  });

  it("applies an invite's grants and consumes it once", async () => {
    const owner = await bootstrapOwner();
    const ownerClient = clientFor(testDb.db, owner);
    const team = await ownerClient.topics.create({ name: "team" });
    const gone = await ownerClient.topics.create({ name: "gone" });
    const created = await ownerClient.invites.create({
      grants: [
        { topicId: team.id, role: "publisher" },
        { topicId: gone.id, role: "subscriber" },
      ],
    });
    await ownerClient.topics.delete({ id: gone.id });

    const { user: newUser } = await signUp("new@example.com", created.code);
    const memberships = await testDb.db
      .select({ topicId: topicMember.topicId, role: topicMember.role })
      .from(topicMember)
      .where(eq(topicMember.userId, newUser.id));
    expect(memberships).toEqual([{ topicId: team.id, role: "publisher" }]);
    const subscriptions = await testDb.db
      .select({ topicId: subscription.topicId, muted: subscription.muted })
      .from(subscription)
      .where(eq(subscription.userId, newUser.id));
    expect(subscriptions).toEqual([{ topicId: team.id, muted: false }]);

    const [stored] = await testDb.db.select().from(invite).where(eq(invite.id, created.invite.id));
    expect(stored?.acceptedBy).toBe(newUser.id);
    expect(stored?.acceptedAt).toBeInstanceOf(Date);
    const newClient = clientFor(testDb.db, {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
    });
    expect((await newClient.topics.list()).map((t) => [t.name, t.role])).toEqual([
      ["team", "publisher"],
    ]);

    await expect(signUp("again@example.com", created.code)).rejects.toMatchObject(forbidden);
    expect(await userCount()).toBe(2);
  });

  it("enforces an email-locked invite case-insensitively", async () => {
    const owner = await bootstrapOwner();
    const { code } = await clientFor(testDb.db, owner).invites.create({
      email: "Locked@Example.com",
    });
    await expect(signUp("other@example.com", code)).rejects.toMatchObject({
      ...forbidden,
      message: expect.stringContaining("different email"),
    });
    await expect(signUp("LOCKED@example.COM", code)).resolves.toMatchObject({
      user: { email: "locked@example.com" },
    });
  });

  it("rejects revoked and expired invites", async () => {
    const owner = await bootstrapOwner();
    const client = clientFor(testDb.db, owner);
    const revoked = await client.invites.create({});
    await client.invites.revoke({ id: revoked.invite.id });
    await expect(signUp("a@example.com", revoked.code)).rejects.toMatchObject(forbidden);

    const expired = await client.invites.create({});
    await testDb.db
      .update(invite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invite.id, expired.invite.id));
    await expect(signUp("b@example.com", expired.code)).rejects.toMatchObject(forbidden);
    expect(await userCount()).toBe(1);
  });

  it("removes the account when the invite is used up between the checks", async () => {
    const owner = await bootstrapOwner();
    const { code, invite: created } = await clientFor(testDb.db, owner).invites.create({});
    // Simulate a concurrent sign-up claiming the code after this request's `before`
    // hook passed: the first batch (the one in `consumeInvite`) runs after the claim.
    const racing = createAuth(ENV, testDb.db);
    const originalBatch = testDb.db.batch.bind(testDb.db);
    let claimedElsewhere = false;
    const spy = vi.spyOn(testDb.db, "batch").mockImplementationOnce(async (queries) => {
      claimedElsewhere = true;
      await testDb.db
        .update(invite)
        .set({ acceptedAt: new Date(), acceptedBy: owner.id })
        .where(eq(invite.id, created.id));
      return await originalBatch(queries);
    });
    // A variable, not a literal: better-auth's body type does not declare `inviteCode`.
    const body = { name: "late", email: "late@example.com", password: PASSWORD, inviteCode: code };
    try {
      await expect(racing.api.signUpEmail({ body })).rejects.toMatchObject({
        ...forbidden,
        message: expect.stringContaining("already used"),
      });
    } finally {
      spy.mockRestore();
    }
    expect(claimedElsewhere).toBe(true);
    expect(await userCount()).toBe(1);
  });

  it("grants nothing to a second consumer of the same invite", async () => {
    const owner = await bootstrapOwner();
    const ownerClient = clientFor(testDb.db, owner);
    const team = await ownerClient.topics.create({ name: "team" });
    const { invite: created } = await ownerClient.invites.create({
      grants: [{ topicId: team.id, role: "subscriber" }],
    });
    const first = await seedUser(testDb.db, "first");
    const second = await seedUser(testDb.db, "second");

    await expect(consumeInvite(testDb.db, created.id, first.id)).resolves.toBe(true);
    await expect(consumeInvite(testDb.db, created.id, second.id)).resolves.toBe(false);
    const members = await testDb.db
      .select({ userId: topicMember.userId })
      .from(topicMember)
      .where(eq(topicMember.topicId, team.id));
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([first.id, owner.id]));
    expect(await testDb.db.$count(subscription, eq(subscription.userId, second.id))).toBe(0);
  });
});
