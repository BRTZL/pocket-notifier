import { defineRequestState } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { mcp, requireMcpAuth } from "@better-auth/mcp";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Database } from "@notifier/db";
import * as authSchema from "@notifier/db/schema/auth";
import * as oauthSchema from "@notifier/db/schema/oauth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";

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

const schema = { ...authSchema, ...oauthSchema };

const SIGN_UP_PATH = "/sign-up/email";

const TRAILING_SLASHES = /\/+$/u;

/** Scopes of the notifier MCP server. `notifier:write` sends notifications and edits features. */
export const MCP_SCOPES = ["notifier:read", "notifier:write"] as const;

/** Paths of the Worker's own sign-in and consent pages for MCP clients (`apps/server`). */
export const OAUTH_LOGIN_PATH = "/oauth/login";
export const OAUTH_CONSENT_PATH = "/oauth/consent";

/** The MCP endpoint, which is the OAuth protected resource: `<BETTER_AUTH_URL>/mcp`. */
export function mcpResourceUrl(env: Pick<AuthConfig, "BETTER_AUTH_URL">): string {
  return `${env.BETTER_AUTH_URL.replace(TRAILING_SLASHES, "")}/mcp`;
}

/**
 * OAuth 2.1 provider for MCP clients (Claude Code, Codex, any MCP client): dynamic client
 * registration for public clients with PKCE, tokens audience-bound to the MCP endpoint
 * and signed with the `jwt` plugin's keys. Sign-in and consent happen on the Worker's own
 * pages; sign-up stays invite-only and is not offered there.
 */
function mcpProvider(env: AuthConfig) {
  return [
    // Only signs OAuth access tokens: no `set-auth-jwt` header, and `/token` is disabled.
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      resource: mcpResourceUrl(env),
      loginPage: OAUTH_LOGIN_PATH,
      consentPage: OAUTH_CONSENT_PATH,
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      // CLI clients register themselves on first use (RFC 7591), without a session.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Clients that omit application_type with a loopback callback register as native.
      clientRegistrationDefaultApplicationType: "infer",
      accessTokenExpiresIn: 60 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    }),
  ];
}
const INVITE_REQUIRED = "Sign-up needs a valid invite code (inviteCode)";
const INVITE_UNUSABLE = "This invite is invalid, expired or already used";
const EMAIL_MISMATCH = "This invite is for a different email address";

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
              message: EMAIL_MISMATCH,
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
            // Accepted for v1: a finalize failure (fewer grants) or a failed credential insert
            // after the user row leaves the account in place; an owner can fix it by hand.
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
      try {
        await releaseInvite(database, claim.inviteId);
      } catch (error) {
        // Keep the original response; the invite just stays claimed.
        ctx.context.logger.error("Failed to release the invite claim after sign-up", error);
      }
    }
  });

  /**
   * Read-only pre-check before better-auth's own "email already exists" check, so a
   * request without a usable invite gets the same 403 whether or not the email is
   * registered (no account enumeration). The atomic claim in `user.create.before`
   * remains the real guard.
   */
  const before = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) {
      return;
    }
    const code = readInviteCode(ctx.body);
    if (code === undefined) {
      if (await hasNoUsers(database)) {
        return;
      }
      throw new APIError("FORBIDDEN", { message: INVITE_REQUIRED });
    }
    const open = await findOpenInvite(database, code);
    if (!open) {
      throw new APIError("FORBIDDEN", { message: INVITE_UNUSABLE });
    }
    if (!inviteAllowsEmail(open, readEmail(ctx.body))) {
      throw new APIError("FORBIDDEN", { message: EMAIL_MISMATCH });
    }
  });

  return { databaseHooks, hooks: { before, after } };
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
    disabledPaths: ["/token"],
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
    plugins: [expo(), ...mcpProvider(env)],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];

export type Auth = ReturnType<typeof createAuth>;

/** Verified access-token claims: `sub` is the user id, `azp` the OAuth client id. */
export type McpAccessClaims = { sub?: string; azp?: unknown; client_id?: unknown; scope?: unknown };

/**
 * Protects the MCP endpoint: verifies the bearer access token (signature, issuer, the
 * `/mcp` audience, expiry, both notifier scopes) and passes its claims to `handler`.
 * Without a usable token it answers 401 with
 * `WWW-Authenticate: Bearer resource_metadata="<server>/.well-known/oauth-protected-resource/mcp"`.
 * The challenge also asks for `offline_access`, so clients get a refresh token.
 */
export function protectMcp(
  auth: Auth,
  env: Pick<AuthConfig, "BETTER_AUTH_URL">,
  handler: (request: Request, claims: McpAccessClaims) => Promise<Response>,
) {
  return requireMcpAuth(auth, handler, {
    resource: mcpResourceUrl(env),
    requiredScopes: MCP_SCOPES,
    challengeScopes: [...MCP_SCOPES, "offline_access"],
  });
}

/** True when `oauthQuery` (from the sign-in or consent page URL) has a valid, unexpired signature. */
export function verifyOAuthQuery(
  env: Pick<AuthConfig, "BETTER_AUTH_SECRET">,
  oauthQuery: string,
): Promise<boolean> {
  return verifyOAuthQueryParams(oauthQuery, env.BETTER_AUTH_SECRET);
}
