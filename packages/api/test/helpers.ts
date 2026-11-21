import type { Session } from "@notifier/auth";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { createRouterClient } from "@orpc/server";

import type { Dispatch } from "../src/dispatch";
import type { Files } from "../src/lib/files";
import { publicRouter } from "../src/public/router";
import { appRouter } from "../src/router";
import { filesOf } from "./db";

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

export const noopDispatch: Dispatch = {
  messagePublished: () => undefined,
  messagesRead: () => undefined,
};

export function clientFor(
  db: Database,
  testUser: TestUser | null,
  dispatch: Dispatch = noopDispatch,
  files: Files = filesOf(db),
) {
  return createRouterClient(appRouter, {
    context: {
      db,
      session: testUser ? fakeSession(testUser) : null,
      appUrl: TEST_APP_URL,
      dispatch,
      files,
    },
  });
}

/** The public `/v1` router, called directly with `Authorization: Bearer <secret>`. */
export function publicClientFor(db: Database, secret: string, dispatch: Dispatch = noopDispatch) {
  return createRouterClient(publicRouter, {
    context: { db, authorization: `Bearer ${secret}`, dispatch, files: filesOf(db) },
  });
}

/** Matches an `ORPCError` with `code` that is not in the contract's error map. */
export function codeError(code: string) {
  return { code };
}

/** Matches a contract-defined `ORPCError` with `code`, for `rejects.toMatchObject`. */
export function definedError(code: string) {
  return { code, defined: true };
}

/** Waits into the next millisecond, so ids (ULIDs) created after it sort after earlier ones. */
export function nextMillisecond(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 2);
  });
}
