import { TOKEN_PREFIX } from "@notifier/contract/token";
import { accessToken } from "@notifier/db/schema/notifier";
import { randomBase62 } from "@notifier/db/secrets";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateToken, tokenCanPublish, tokenCanRead } from "../src/public/auth";
import { tokenAuthed } from "../src/public/base";
import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, noopDispatch, seedUser, type TestUser } from "./helpers";

/** Errors thrown outside a procedure are not marked `defined`; match on the code. */
function codeError(code: string) {
  return { code };
}

describe("bearer token auth", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let teamId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    ({ id: teamId } = await owner.projects.create({ name: "team" }));
    await owner.projects.create({ name: "ops" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  async function tokenFor(
    testUser: TestUser,
    scope: Parameters<ReturnType<typeof clientFor>["tokens"]["create"]>[0]["scope"],
  ) {
    return await clientFor(testDb.db, testUser).tokens.create({ name: "t", scope });
  }

  it("accepts a valid token and records its use", async () => {
    const { token, secret } = await tokenFor(ada, { kind: "all" });
    const auth = await authenticateToken(testDb.db, `Bearer ${secret}`);
    expect(auth.user.id).toBe(ada.id);
    expect(auth.token.id).toBe(token.id);
    expect(auth.scope).toEqual({ kind: "all" });
    const [stored] = await testDb.db
      .select({ lastUsedAt: accessToken.lastUsedAt })
      .from(accessToken)
      .where(eq(accessToken.id, token.id));
    expect(stored?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("rejects missing, malformed, unknown, revoked and expired tokens", async () => {
    const unauthorized = codeError("UNAUTHORIZED");
    const { token, secret } = await tokenFor(ada, { kind: "all" });

    await expect(authenticateToken(testDb.db, null)).rejects.toMatchObject(unauthorized);
    await expect(authenticateToken(testDb.db, "")).rejects.toMatchObject(unauthorized);
    await expect(authenticateToken(testDb.db, secret)).rejects.toMatchObject(unauthorized);
    await expect(authenticateToken(testDb.db, `Basic ${secret}`)).rejects.toMatchObject(
      unauthorized,
    );
    await expect(authenticateToken(testDb.db, "Bearer nt_short")).rejects.toMatchObject(
      unauthorized,
    );
    const badHeaders = [
      `Bearer\n${secret}`,
      `Bearer\t${secret}`,
      `Bearer\u00a0${secret}`,
      `Bearer  ${secret}`,
      `Bearer ${secret} `,
      `Bearer ${secret}\n`,
    ];
    const results = await Promise.allSettled(
      badHeaders.map((header) => authenticateToken(testDb.db, header)),
    );
    for (const result of results) {
      expect(result).toMatchObject({ status: "rejected", reason: unauthorized });
    }
    // The scheme is case-insensitive.
    await expect(authenticateToken(testDb.db, `bearer ${secret}`)).resolves.toMatchObject({
      user: { id: ada.id },
    });
    await expect(
      authenticateToken(testDb.db, `Bearer ${TOKEN_PREFIX}${randomBase62(40)}`),
    ).rejects.toMatchObject(unauthorized);

    await testDb.db
      .update(accessToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessToken.id, token.id));
    await expect(authenticateToken(testDb.db, `Bearer ${secret}`)).rejects.toMatchObject({
      ...unauthorized,
      message: expect.stringContaining("expired"),
    });

    await testDb.db
      .update(accessToken)
      .set({ expiresAt: null, revokedAt: new Date() })
      .where(eq(accessToken.id, token.id));
    await expect(authenticateToken(testDb.db, `Bearer ${secret}`)).rejects.toMatchObject({
      ...unauthorized,
      message: expect.stringContaining("revoked"),
    });
  });

  it("rejects a token revoked between the lookup and the last_used_at write", async () => {
    const { token, secret } = await tokenFor(ada, { kind: "all" });
    const realUpdate = testDb.db.update.bind(testDb.db);
    const revokeNow = () =>
      realUpdate(accessToken).set({ revokedAt: new Date() }).where(eq(accessToken.id, token.id));
    // The lookup has already passed when `update` is called; revoke before the write runs.
    const spy = vi.spyOn(testDb.db, "update").mockImplementationOnce((table) => {
      const builder = realUpdate(table);
      const realSet = builder.set.bind(builder);
      return Object.assign(builder, {
        set: (...setArgs: Parameters<typeof realSet>) => {
          const query = realSet(...setArgs);
          const realThen = query.then.bind(query);
          vi.spyOn(query, "then").mockImplementationOnce((onFulfilled, onRejected) =>
            revokeNow().then(() => realThen(onFulfilled, onRejected)),
          );
          return query;
        },
      });
    });
    try {
      await expect(authenticateToken(testDb.db, `Bearer ${secret}`)).rejects.toMatchObject(
        codeError("UNAUTHORIZED"),
      );
    } finally {
      spy.mockRestore();
    }
    const [stored] = await testDb.db
      .select({ lastUsedAt: accessToken.lastUsedAt, revokedAt: accessToken.revokedAt })
      .from(accessToken)
      .where(eq(accessToken.id, token.id));
    expect(stored?.revokedAt).toBeInstanceOf(Date);
    expect(stored?.lastUsedAt).toBeNull();
  });

  it("checks scope, membership and role for publish and read", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.members.add({ projectId: teamId, email: bob.email, role: "publisher" });

    const scoped = await authenticateToken(
      testDb.db,
      `Bearer ${(await tokenFor(ada, { kind: "projects", projects: ["team"] })).secret}`,
    );
    await expect(tokenCanPublish(testDb.db, scoped, "team")).resolves.toMatchObject({
      id: teamId,
    });
    await expect(tokenCanPublish(testDb.db, scoped, "ops")).rejects.toMatchObject(
      codeError("FORBIDDEN"),
    );
    await expect(tokenCanRead(testDb.db, scoped, "ops")).rejects.toMatchObject(
      codeError("FORBIDDEN"),
    );
    await expect(tokenCanRead(testDb.db, scoped, "missing")).rejects.toMatchObject(
      codeError("NOT_FOUND"),
    );

    const bobAll = await authenticateToken(
      testDb.db,
      `Bearer ${(await tokenFor(bob, { kind: "all" })).secret}`,
    );
    const bobTeam = await authenticateToken(
      testDb.db,
      `Bearer ${(await tokenFor(bob, { kind: "projects", projects: ["team"] })).secret}`,
    );
    await expect(tokenCanPublish(testDb.db, bobAll, "team")).resolves.toMatchObject({
      id: teamId,
    });
    // Not a member of `ops`: indistinguishable from a missing project.
    await expect(tokenCanPublish(testDb.db, bobAll, "ops")).rejects.toMatchObject(
      codeError("NOT_FOUND"),
    );

    // Demoted to subscriber: the token can still read its scoped project, not publish.
    await owner.members.update({ projectId: teamId, userId: bob.id, role: "subscriber" });
    await expect(tokenCanPublish(testDb.db, bobTeam, "team")).rejects.toMatchObject(
      codeError("FORBIDDEN"),
    );
    await expect(tokenCanRead(testDb.db, bobTeam, "team")).resolves.toMatchObject({
      id: teamId,
    });
    // `all` only covers projects where the user is owner or publisher.
    await expect(tokenCanRead(testDb.db, bobAll, "team")).rejects.toMatchObject(
      codeError("FORBIDDEN"),
    );

    // Removed from the project: tokens stop working for it immediately.
    await owner.members.remove({ projectId: teamId, userId: bob.id });
    await expect(tokenCanRead(testDb.db, bobTeam, "team")).rejects.toMatchObject(
      codeError("NOT_FOUND"),
    );
  });

  it("public procedures get the verified token in context", async () => {
    const { secret } = await tokenFor(ada, { kind: "all" });
    const probe = tokenAuthed.messages.list.handler(({ context }) => {
      expect(context.auth.user.id).toBe(ada.id);
      return { items: [], nextCursor: null };
    });
    await expect(
      call(
        probe,
        { project: "team" },
        { context: { db: testDb.db, authorization: `Bearer ${secret}`, dispatch: noopDispatch } },
      ),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      call(
        probe,
        { project: "team" },
        { context: { db: testDb.db, authorization: null, dispatch: noopDispatch } },
      ),
    ).rejects.toMatchObject(definedError("UNAUTHORIZED"));
  });
});
