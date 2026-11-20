import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@notifier/db";
import * as schema from "@notifier/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { consumeInvite, findOpenInvite, hasNoUsers, inviteAllowsEmail } from "./invites";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

const SIGN_UP_PATH = "/sign-up/email";
const INVITE_REQUIRED = "Sign-up needs a valid invite code (inviteCode)";

/** The body's `inviteCode`; `null` and `""` (an empty form field) count as absent. */
function readInviteCode(body: unknown): unknown {
  const code =
    body && typeof body === "object" && "inviteCode" in body ? body.inviteCode : undefined;
  return code === null || code === "" ? undefined : code;
}

function readEmail(body: unknown): string {
  return body && typeof body === "object" && "email" in body && typeof body.email === "string"
    ? body.email
    : "";
}

/** The new user's id from the sign-up endpoint's result, or `null` when it failed. */
function signedUpUserId(returned: unknown): string | null {
  if (!returned || typeof returned !== "object" || returned instanceof Error) {
    return null;
  }
  const created = "user" in returned ? returned.user : null;
  return created && typeof created === "object" && "id" in created && typeof created.id === "string"
    ? created.id
    : null;
}

/**
 * Invite-only sign-up. `inviteCode` is an extra field in the `/sign-up/email` body:
 * better-auth's body schema allows unknown keys and only persists configured user
 * fields, so the hooks read it from `ctx.body` and it is never stored on the user.
 * The very first account (empty user table) is the deployment owner and needs none.
 */
function inviteOnlySignUp(database: Database) {
  const before = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) {
      return;
    }
    const code = readInviteCode(ctx.body);
    if (code === undefined && (await hasNoUsers(database))) {
      return;
    }
    const open = await findOpenInvite(database, code);
    if (!open) {
      throw new APIError("FORBIDDEN", {
        message:
          code === undefined ? INVITE_REQUIRED : "This invite is invalid, expired or already used",
      });
    }
    if (!inviteAllowsEmail(open, readEmail(ctx.body))) {
      throw new APIError("FORBIDDEN", { message: "This invite is for a different email address" });
    }
  });

  const after = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) {
      return;
    }
    const userId = signedUpUserId(ctx.context.returned);
    if (!userId) {
      return;
    }
    const code = readInviteCode(ctx.body);
    let accepted = false;
    let failure: unknown;
    try {
      if (code === undefined) {
        // Bootstrap: allowed only if this is still the one and only user.
        const users = await ctx.context.internalAdapter.countTotalUsers();
        accepted = users === 1;
      } else {
        const open = await findOpenInvite(database, code);
        accepted = open !== null && (await consumeInvite(database, open.id, userId));
      }
    } catch (error) {
      failure = error;
    }
    if (!accepted) {
      // Lost a race (code used concurrently, or two first sign-ups) or the claim failed:
      // undo the account (sessions and accounts cascade) so it cannot be used.
      if (failure !== undefined) {
        ctx.context.logger.error("Failed to consume the invite after sign-up", failure);
      }
      await ctx.context.internalAdapter.deleteUser(userId);
      throw new APIError("FORBIDDEN", {
        message:
          code === undefined ? INVITE_REQUIRED : "This invite is invalid, expired or already used",
      });
    }
  });

  return { before, after };
}

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      "notifier://",
      "exp://",
      "http://localhost:8081",
    ],
    emailAndPassword: { enabled: true },
    hooks: inviteOnlySignUp(database),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [expo()],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
