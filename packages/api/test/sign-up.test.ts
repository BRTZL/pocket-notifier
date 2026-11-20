import { createAuth } from "@notifier/auth";
import { claimInvite, finalizeInvite } from "@notifier/auth/invites";
import { account, user } from "@notifier/db/schema/auth";
import { invite, projectMember, subscription } from "@notifier/db/schema/notifier";
import { eq, inArray } from "drizzle-orm";
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

  it("treats an empty or null inviteCode as absent for the first account", async () => {
    await expect(signUp("first@example.com", "")).resolves.toMatchObject({
      user: { email: "first@example.com" },
    });
    await expect(signUp("second@example.com", null)).rejects.toMatchObject({
      ...forbidden,
      message: expect.stringContaining("needs a valid invite"),
    });
  });

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
    const team = await ownerClient.projects.create({ name: "team" });
    const gone = await ownerClient.projects.create({ name: "gone" });
    const created = await ownerClient.invites.create({
      grants: [
        { projectId: team.id, role: "publisher" },
        { projectId: gone.id, role: "subscriber" },
      ],
    });
    await ownerClient.projects.delete({ id: gone.id });

    const { user: newUser } = await signUp("new@example.com", created.code);
    const memberships = await testDb.db
      .select({ projectId: projectMember.projectId, role: projectMember.role })
      .from(projectMember)
      .where(eq(projectMember.userId, newUser.id));
    expect(memberships).toEqual([{ projectId: team.id, role: "publisher" }]);
    const subscriptions = await testDb.db
      .select({ projectId: subscription.projectId, muted: subscription.muted })
      .from(subscription)
      .where(eq(subscription.userId, newUser.id));
    expect(subscriptions).toEqual([{ projectId: team.id, muted: false }]);

    const [stored] = await testDb.db.select().from(invite).where(eq(invite.id, created.invite.id));
    expect(stored?.acceptedBy).toBe(newUser.id);
    expect(stored?.acceptedAt).toBeInstanceOf(Date);
    const newClient = clientFor(testDb.db, {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
    });
    const listed = await newClient.projects.list();
    expect(listed.filter((t) => !t.personal).map((t) => [t.name, t.role])).toEqual([
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

  async function credentialCount(email: string) {
    return await testDb.db.$count(
      account,
      inArray(
        account.userId,
        testDb.db.select({ id: user.id }).from(user).where(eq(user.email, email)),
      ),
    );
  }

  /** Runs `fn` right before the next `db.update(...).set(...)` statement executes. */
  function beforeNextUpdate(fn: () => Promise<unknown>) {
    const realUpdate = testDb.db.update.bind(testDb.db);
    return vi.spyOn(testDb.db, "update").mockImplementationOnce((table) => {
      const builder = realUpdate(table);
      const realSet = builder.set.bind(builder);
      return Object.assign(builder, {
        set: (...setArgs: Parameters<typeof realSet>) => {
          const query = realSet(...setArgs);
          const realThen = query.then.bind(query);
          vi.spyOn(query, "then").mockImplementationOnce((onFulfilled, onRejected) =>
            fn().then(() => realThen(onFulfilled, onRejected)),
          );
          return query;
        },
      });
    });
  }

  it("creates no account when the invite is claimed concurrently", async () => {
    const owner = await bootstrapOwner();
    const { code, invite: created } = await clientFor(testDb.db, owner).invites.create({});
    // Another sign-up claims the code after this one found it open, before its claim runs.
    let claimedElsewhere = false;
    const spy = beforeNextUpdate(async () => {
      claimedElsewhere = true;
      await testDb.db
        .update(invite)
        .set({ acceptedAt: new Date() })
        .where(eq(invite.id, created.id));
    });
    const body = { name: "late", email: "late@example.com", password: PASSWORD, inviteCode: code };
    try {
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({
        ...forbidden,
        message: expect.stringContaining("already used"),
      });
      expect(claimedElsewhere).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(await testDb.db.$count(user, eq(user.email, "late@example.com"))).toBe(0);
    expect(await credentialCount("late@example.com")).toBe(0);
  });

  it("creates no account when claiming the invite throws", async () => {
    const owner = await bootstrapOwner();
    const { code } = await clientFor(testDb.db, owner).invites.create({});
    const spy = vi.spyOn(testDb.db, "update").mockImplementationOnce(() => {
      throw new Error("D1_ERROR: simulated failure");
    });
    const body = { name: "boom", email: "boom@example.com", password: PASSWORD, inviteCode: code };
    try {
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({ statusCode: 422 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await testDb.db.$count(user, eq(user.email, "boom@example.com"))).toBe(0);
    await expect(
      auth.api.signInEmail({ body: { email: "boom@example.com", password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 401 });
    // The invite is still open, so the person can retry.
    await expect(clientFor(testDb.db, null).invites.preview({ code })).resolves.toMatchObject({
      invitedBy: owner.name,
    });
  });

  it("releases the claim when creating the user fails after it", async () => {
    const owner = await bootstrapOwner();
    const { code } = await clientFor(testDb.db, owner).invites.create({});
    const spy = vi.spyOn(testDb.db, "insert").mockImplementationOnce(() => {
      throw new Error("D1_ERROR: simulated user insert failure");
    });
    const body = {
      name: "retry",
      email: "retry@example.com",
      password: PASSWORD,
      inviteCode: code,
    };
    try {
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({ statusCode: 422 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await testDb.db.$count(user, eq(user.email, "retry@example.com"))).toBe(0);
    await expect(auth.api.signUpEmail({ body })).resolves.toMatchObject({
      user: { email: "retry@example.com" },
    });
  });

  it("keeps the original error when releasing the claim fails too", async () => {
    const owner = await bootstrapOwner();
    const { code } = await clientFor(testDb.db, owner).invites.create({});
    const realUpdate = testDb.db.update.bind(testDb.db);
    const insertSpy = vi.spyOn(testDb.db, "insert").mockImplementationOnce(() => {
      throw new Error("D1_ERROR: simulated user insert failure");
    });
    // First update is the claim (real), the second is the release (fails).
    const updateSpy = vi
      .spyOn(testDb.db, "update")
      .mockImplementationOnce((table) => realUpdate(table))
      .mockImplementationOnce(() => {
        throw new Error("D1_ERROR: simulated release failure");
      });
    const body = { name: "x", email: "x@example.com", password: PASSWORD, inviteCode: code };
    try {
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({ statusCode: 422 });
      expect(updateSpy).toHaveBeenCalledTimes(2);
    } finally {
      insertSpy.mockRestore();
      updateSpy.mockRestore();
    }
    expect(await testDb.db.$count(user, eq(user.email, "x@example.com"))).toBe(0);
    // The release failed, so the invite stays claimed (no longer open).
    await expect(clientFor(testDb.db, null).invites.preview({ code })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("answers the same 403 for registered and new emails without a usable invite", async () => {
    await bootstrapOwner();
    const attempts = [undefined, "A".repeat(24), "not-a-code"].flatMap((code) =>
      ["owner@example.com", "fresh@example.com"].map((email) => ({ code, email })),
    );
    const results = await Promise.allSettled(
      attempts.map(({ code, email }) => signUp(email, code)),
    );
    const outcomes = results.map((result) =>
      result.status === "rejected"
        ? {
            status: (result.reason as { statusCode?: number }).statusCode,
            message: (result.reason as Error).message,
          }
        : { status: 200, message: "" },
    );
    for (let index = 0; index < outcomes.length; index += 2) {
      expect(outcomes[index]?.status).toBe(403);
      expect(outcomes[index + 1]).toEqual(outcomes[index]);
    }
    expect(await userCount()).toBe(1);
  });

  it("only applies grants for projects the inviter still owns", async () => {
    const owner = await bootstrapOwner();
    const helper = await seedUser(testDb.db, "helper");
    const ownerClient = clientFor(testDb.db, owner);
    const team = await ownerClient.projects.create({ name: "team" });
    const ops = await ownerClient.projects.create({ name: "ops" });
    const created = await ownerClient.invites.create({
      grants: [
        { projectId: team.id, role: "publisher" },
        { projectId: ops.id, role: "subscriber" },
      ],
    });
    // The inviter stops owning `team` before the invite is accepted.
    await ownerClient.members.add({ projectId: team.id, email: helper.email, role: "publisher" });
    await ownerClient.members.update({ projectId: team.id, userId: helper.id, role: "owner" });
    await clientFor(testDb.db, helper).members.update({
      projectId: team.id,
      userId: owner.id,
      role: "subscriber",
    });

    await expect(
      clientFor(testDb.db, null).invites.preview({ code: created.code }),
    ).resolves.toMatchObject({ projects: ["ops"] });

    const { user: newUser } = await signUp("new@example.com", created.code);
    const memberships = await testDb.db
      .select({ projectId: projectMember.projectId, role: projectMember.role })
      .from(projectMember)
      .where(eq(projectMember.userId, newUser.id));
    expect(memberships).toEqual([{ projectId: ops.id, role: "subscriber" }]);
    expect(await testDb.db.$count(subscription, eq(subscription.userId, newUser.id))).toBe(1);
  });

  it("claims an invite once and links it to one user only", async () => {
    const owner = await bootstrapOwner();
    const ownerClient = clientFor(testDb.db, owner);
    const team = await ownerClient.projects.create({ name: "team" });
    const { invite: created } = await ownerClient.invites.create({
      grants: [{ projectId: team.id, role: "subscriber" }],
    });
    const first = await seedUser(testDb.db, "first");
    const second = await seedUser(testDb.db, "second");

    await expect(claimInvite(testDb.db, created.id)).resolves.toBe(true);
    await expect(claimInvite(testDb.db, created.id)).resolves.toBe(false);
    await expect(finalizeInvite(testDb.db, created.id, first.id)).resolves.toBe(true);
    await expect(finalizeInvite(testDb.db, created.id, second.id)).resolves.toBe(false);
    const members = await testDb.db
      .select({ userId: projectMember.userId })
      .from(projectMember)
      .where(eq(projectMember.projectId, team.id));
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([first.id, owner.id]));
    expect(await testDb.db.$count(subscription, eq(subscription.userId, second.id))).toBe(0);
  });
});
