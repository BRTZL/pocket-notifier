import { TokenSecret } from "@notifier/contract/token";
import { accessToken } from "@notifier/db/schema/notifier";
import { sha256Hex } from "@notifier/db/secrets";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, seedUser, type TestUser } from "./helpers";

describe("tokens", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("returns the secret once and stores only its hash", async () => {
    const client = clientFor(testDb.db, ada);
    const { token, secret } = await client.tokens.create({
      name: "ci",
      scope: { kind: "all" },
      expiresInDays: 30,
    });
    expect(TokenSecret.safeParse(secret).success).toBe(true);
    expect(token).toMatchObject({
      name: "ci",
      start: secret.slice(0, 7),
      scope: { kind: "all" },
      lastUsedAt: null,
    });
    const expiresInMs = Date.parse(token.expiresAt ?? "") - Date.now();
    expect(Math.round(expiresInMs / 86_400_000)).toBe(30);

    const [stored] = await testDb.db.select().from(accessToken).where(eq(accessToken.id, token.id));
    expect(stored?.hash).toBe(await sha256Hex(secret));
    expect(JSON.stringify(stored)).not.toContain(secret);

    const listed = await client.tokens.list();
    expect(listed).toEqual([token]);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("lists expired tokens that are not revoked", async () => {
    const client = clientFor(testDb.db, ada);
    const { token } = await client.tokens.create({
      name: "old",
      scope: { kind: "all" },
      expiresInDays: 1,
    });
    const past = new Date(Date.now() - 1000);
    await testDb.db
      .update(accessToken)
      .set({ expiresAt: past })
      .where(eq(accessToken.id, token.id));
    expect(await client.tokens.list()).toEqual([{ ...token, expiresAt: past.toISOString() }]);
  });

  it("lists only the caller's non-revoked tokens, newest first", async () => {
    const client = clientFor(testDb.db, ada);
    const first = await client.tokens.create({ name: "one", scope: { kind: "all" } });
    const second = await client.tokens.create({ name: "two", scope: { kind: "all" } });
    await testDb.db
      .update(accessToken)
      .set({ createdAt: new Date(Date.now() + 1000) })
      .where(eq(accessToken.id, second.token.id));
    await clientFor(testDb.db, bob).tokens.create({ name: "bob", scope: { kind: "all" } });
    expect((await client.tokens.list()).map((t) => t.name)).toEqual(["two", "one"]);

    await client.tokens.revoke({ id: first.token.id });
    expect((await client.tokens.list()).map((t) => t.name)).toEqual(["two"]);
  });

  it("checks topic scopes against the caller's role", async () => {
    const owner = clientFor(testDb.db, ada);
    const team = await owner.topics.create({ name: "team" });
    await owner.topics.create({ name: "ops" });
    await owner.members.add({ topicId: team.id, email: bob.email, role: "subscriber" });
    const bobClient = clientFor(testDb.db, bob);

    await expect(
      bobClient.tokens.create({ name: "x", scope: { kind: "topics", topics: ["team"] } }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    await expect(
      bobClient.tokens.create({ name: "x", scope: { kind: "topics", topics: ["ops"] } }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));
    await expect(
      owner.tokens.create({ name: "x", scope: { kind: "topics", topics: ["team", "missing"] } }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));

    await owner.members.update({ topicId: team.id, userId: bob.id, role: "publisher" });
    const { token } = await bobClient.tokens.create({
      name: "x",
      scope: { kind: "topics", topics: ["team", "team"] },
    });
    expect(token.scope).toEqual({ kind: "topics", topics: ["team"] });
  });

  it("revokes idempotently and hides other users' tokens", async () => {
    const client = clientFor(testDb.db, ada);
    const { token } = await client.tokens.create({ name: "ci", scope: { kind: "all" } });

    await expect(clientFor(testDb.db, bob).tokens.revoke({ id: token.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    await expect(
      client.tokens.revoke({ id: "tok_00000000000000000000000000" }),
    ).rejects.toMatchObject(definedError("NOT_FOUND"));

    await expect(client.tokens.revoke({ id: token.id })).resolves.toEqual({ ok: true });
    const [afterFirst] = await testDb.db
      .select({ revokedAt: accessToken.revokedAt })
      .from(accessToken)
      .where(eq(accessToken.id, token.id));
    await expect(client.tokens.revoke({ id: token.id })).resolves.toEqual({ ok: true });
    const [afterSecond] = await testDb.db
      .select({ revokedAt: accessToken.revokedAt })
      .from(accessToken)
      .where(eq(accessToken.id, token.id));
    expect(afterFirst?.revokedAt).toBeInstanceOf(Date);
    expect(afterSecond?.revokedAt).toEqual(afterFirst?.revokedAt);
  });

  it("requires a session", async () => {
    await expect(clientFor(testDb.db, null).tokens.list()).rejects.toMatchObject(
      definedError("UNAUTHORIZED"),
    );
  });
});
