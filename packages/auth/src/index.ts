import { defineRequestState } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@notifier/db";
import * as schema from "@notifier/db/schema/auth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import {
  claimInvite,
  finalizeInvite,
  findOpenInvite,
  hasNoUsers,
  inviteAllowsEmail,
  releaseInvite,
} from "./invites";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

const SIGN_UP_PATH = "/sign-up/email";
const INVITE_REQUIRED = "Sign-up needs a valid invite code (inviteCode)";
const INVITE_UNUSABLE = "This invite is invalid, expired or already used";

/** The body's `inviteCode`; `null` and `""` (an empty form field) count as absent. */
function readInviteCode(body: unknown): unknown {
  const code =
    body && typeof body === "object" && "inviteCode" in body ? body.inviteCode : undefined;
  return code === null || code === "" ? undefined : code;
}

/**
 * The invite this request claimed, if any. better-auth request state is a per-request
 * store (an AsyncLocalStorage-scoped WeakMap), so concurrent requests never see each
 * other's claim.
 */
type InviteClaim = { inviteId: string; userId: string | null };
const inviteClaim = defineRequestState<InviteClaim | null>(() => null);

/**
 * Invite-only sign-up. `inviteCode` is an extra field in the `/sign-up/email` body:
 * better-auth's body schema allows unknown keys and only persists configured user
 * fields, so it is read from the endpoint context's body and never stored.
 *
 * The invite is claimed atomically in `user.create.before`, before the user row and
 * its password credential exist, so no account can exist without a claimed invite.
 * `user.create.after` links the invite to the new user and applies its grants. If
 * the request fails between the two (the user insert throws), the `after` endpoint
 * hook releases the claim so the code can be used again.
 */
function inviteOnlySignUp(database: Database) {
  const databaseHooks: BetterAuthOptions["databaseHooks"] = {
    user: {
      create: {
        before: async (newUser, ctx) => {
          const code = readInviteCode(ctx?.body);
          if (code === undefined) {
            // Bootstrap: the first account of a fresh single-owner deployment needs no
            // invite. Two concurrent first sign-ups could both pass; that is an accepted
            // residual risk for a deployment nobody else knows about yet.
            if (await hasNoUsers(database)) {
              return;
            }
            throw new APIError("FORBIDDEN", { message: INVITE_REQUIRED });
          }
          const open = await findOpenInvite(database, code);
          if (!open) {
            throw new APIError("FORBIDDEN", { message: INVITE_UNUSABLE });
          }
          if (!inviteAllowsEmail(open, newUser.email)) {
            throw new APIError("FORBIDDEN", {
              message: "This invite is for a different email address",
            });
          }
          if (!(await claimInvite(database, open.id))) {
            throw new APIError("FORBIDDEN", { message: INVITE_UNUSABLE });
          }
          await inviteClaim.set({ inviteId: open.id, userId: null });
        },
        after: async (createdUser, ctx) => {
          const claim = await inviteClaim.get();
          if (!claim) {
            return;
          }
          await inviteClaim.set({ ...claim, userId: createdUser.id });
          try {
            await finalizeInvite(database, claim.inviteId, createdUser.id);
          } catch (error) {
            // The account is legitimately invited (the claim held); only the grants are
            // missing, and an owner can add the memberships by hand. Keep the sign-up.
            ctx?.context.logger.error("Failed to apply invite grants after sign-up", error);
          }
        },
      },
    },
  };

  const after = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) {
      return;
    }
    const claim = await inviteClaim.get();
    if (claim && claim.userId === null) {
      // Claimed, but no user was created with it: give the code back (best effort).
      await releaseInvite(database, claim.inviteId);
    }
  });

  return { databaseHooks, hooks: { after } };
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
    ...inviteOnlySignUp(database),
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
