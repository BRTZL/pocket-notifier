import type { Session } from "@notifier/auth";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { createRouterClient } from "@orpc/server";

import { appRouter } from "../src/router";

export const TEST_APP_URL = "http://web.test";

export type TestUser = { id: string; name: string; email: string };

export async function seedUser(db: Database, id: string): Promise<TestUser> {
  const row = { id, name: `User ${id}`, email: `${id}@example.com` };
  await db.insert(user).values(row);
  return row;
}

/** A session shaped like better-auth's `getSession` result. */
export function fakeSession(testUser: TestUser): Session {
  const now = new Date();
  return {
    session: {
      id: `session_${testUser.id}`,
      token: `token_${testUser.id}`,
      userId: testUser.id,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: testUser.id,
      name: testUser.name,
      email: testUser.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function clientFor(db: Database, testUser: TestUser | null) {
  return createRouterClient(appRouter, {
    context: { db, session: testUser ? fakeSession(testUser) : null, appUrl: TEST_APP_URL },
  });
}

/** Matches a contract-defined `ORPCError` with `code`, for `rejects.toMatchObject`. */
export function definedError(code: string) {
  return { code, defined: true };
}
