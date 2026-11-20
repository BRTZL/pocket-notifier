/**
 * Sign-in and consent pages of the OAuth flow MCP clients use. The OAuth provider
 * (better-auth `mcp` plugin) redirects here with a signed copy of the authorization
 * request (`oauth_query`); the forms post back here and these handlers call the auth
 * endpoints server side, then redirect the browser to where the provider says.
 */
import { AUTH_PATH, OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH } from "@notifier/auth/paths";
import type { Context, Env, Hono } from "hono";

import { ConsentPage, LoginPage, MessagePage } from "./pages";

export type OAuthClientInfo = { name: string | null };

export type OAuthPageDeps = {
  /** Origin of the auth server (`BETTER_AUTH_URL`); internal auth requests use it. */
  authOrigin: string;
  authHandler: (request: Request) => Promise<Response>;
  /** The signed-in user for these request headers, or `null`. */
  getSessionUser: (headers: Headers) => Promise<{ email: string } | null>;
  /** True when `oauthQuery` carries a valid, unexpired provider signature. */
  verifyOAuthQuery: (oauthQuery: string) => Promise<boolean>;
  findClient: (clientId: string) => Promise<OAuthClientInfo | null>;
};

/**
 * No `form-action`: browsers apply it to the redirect after a form post too, and the
 * consent post ends in a redirect to the client's loopback callback. Cross-site posts are
 * refused by `isSameOrigin` instead.
 */
const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

const LOGIN_FAILED = "Wrong email or password.";
const EXPIRED =
  "This sign-in link expired or was changed. Start again from your app, e.g. run the MCP login again.";

async function withHeaders(pending: Response | Promise<Response>): Promise<Response> {
  const response = await pending;
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/** The raw query string of the request, without `?`. */
function rawQuery(c: Context): string {
  return new URL(c.req.url).search.slice(1);
}

/**
 * Form posts must come from these pages: the session cookie is `SameSite=None`, so
 * without this a cross-site form could approve consent for an attacker's client.
 */
function isSameOrigin(c: Context): boolean {
  const own = new URL(c.req.url).origin;
  const origin = c.req.header("Origin");
  if (origin) {
    return origin === own;
  }
  return c.req.header("Sec-Fetch-Site") === "same-origin";
}

async function readForm(c: Context): Promise<Record<string, string>> {
  const form = await c.req.parseBody();
  return Object.fromEntries(
    Object.entries(form).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
}

/** Follows a `{ redirect: true, url }` answer of the auth endpoints, keeping its cookies. */
async function redirectFrom(c: Context, answer: Response): Promise<Response | null> {
  const body = (await answer.json().catch(() => null)) as { url?: unknown } | null;
  if (!answer.ok || typeof body?.url !== "string") {
    return null;
  }
  const response = c.redirect(body.url, 302);
  for (const cookie of answer.headers.getSetCookie()) {
    response.headers.append("Set-Cookie", cookie);
  }
  return withHeaders(response);
}

/** Kept on the internal auth request, so sessions and rate limits see the real client. */
const FORWARDED_HEADERS = [
  "Cookie",
  "User-Agent",
  "CF-Connecting-IP",
  "X-Forwarded-For",
  "X-Real-IP",
] as const;

function authRequest(c: Context, deps: OAuthPageDeps, path: string, body: unknown) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: deps.authOrigin,
  });
  for (const name of FORWARDED_HEADERS) {
    const value = c.req.header(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return deps.authHandler(
    new Request(`${deps.authOrigin}${AUTH_PATH}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function clientIdOf(oauthQuery: string): string {
  return new URLSearchParams(oauthQuery).get("client_id") ?? "";
}

function redirectHostOf(oauthQuery: string): string {
  const uri = new URLSearchParams(oauthQuery).get("redirect_uri") ?? "";
  return URL.canParse(uri) ? new URL(uri).host : "unknown";
}

function messagePage(c: Context, title: string, message: string, status: 400 | 403) {
  return withHeaders(c.html(<MessagePage message={message} title={title} />, status));
}

export function registerOAuthPages<E extends Env>(app: Hono<E>, deps: OAuthPageDeps) {
  app.get(OAUTH_LOGIN_PATH, async (c) => {
    const oauthQuery = rawQuery(c);
    if (!(await deps.verifyOAuthQuery(oauthQuery))) {
      return messagePage(c, "Link expired", EXPIRED, 400);
    }
    const client = await deps.findClient(clientIdOf(oauthQuery));
    return withHeaders(
      c.html(<LoginPage clientName={client?.name ?? null} oauthQuery={oauthQuery} />),
    );
  });

  app.post(OAUTH_LOGIN_PATH, async (c) => {
    if (!isSameOrigin(c)) {
      return messagePage(c, "Not allowed", "This form can only be sent from its own page.", 403);
    }
    const form = await readForm(c);
    const oauthQuery = form.oauth_query ?? "";
    if (!(await deps.verifyOAuthQuery(oauthQuery))) {
      return messagePage(c, "Link expired", EXPIRED, 400);
    }
    const answer = await authRequest(c, deps, "/sign-in/email", {
      email: form.email ?? "",
      password: form.password ?? "",
      oauth_query: oauthQuery,
    });
    const redirect = await redirectFrom(c, answer);
    if (redirect) {
      return redirect;
    }
    const client = await deps.findClient(clientIdOf(oauthQuery));
    return withHeaders(
      c.html(
        <LoginPage
          clientName={client?.name ?? null}
          email={form.email}
          error={LOGIN_FAILED}
          oauthQuery={oauthQuery}
        />,
        401,
      ),
    );
  });

  app.get(OAUTH_CONSENT_PATH, async (c) => {
    const oauthQuery = rawQuery(c);
    if (!(await deps.verifyOAuthQuery(oauthQuery))) {
      return messagePage(c, "Link expired", EXPIRED, 400);
    }
    const sessionUser = await deps.getSessionUser(c.req.raw.headers);
    if (!sessionUser) {
      // Signing in re-runs the authorization and comes back here.
      return withHeaders(c.redirect(`${OAUTH_LOGIN_PATH}?${oauthQuery}`, 302));
    }
    const client = await deps.findClient(clientIdOf(oauthQuery));
    if (!client) {
      return messagePage(
        c,
        "Unknown app",
        "This app is not registered. Start again from your app.",
        400,
      );
    }
    const scopes = (new URLSearchParams(oauthQuery).get("scope") ?? "").split(" ").filter(Boolean);
    return withHeaders(
      c.html(
        <ConsentPage
          clientName={client.name ?? "Unnamed app"}
          oauthQuery={oauthQuery}
          redirectHost={redirectHostOf(oauthQuery)}
          scopes={scopes}
          userEmail={sessionUser.email}
        />,
      ),
    );
  });

  app.post(OAUTH_CONSENT_PATH, async (c) => {
    if (!isSameOrigin(c)) {
      return messagePage(c, "Not allowed", "This form can only be sent from its own page.", 403);
    }
    const form = await readForm(c);
    const oauthQuery = form.oauth_query ?? "";
    if (!(await deps.verifyOAuthQuery(oauthQuery))) {
      return messagePage(c, "Link expired", EXPIRED, 400);
    }
    const answer = await authRequest(c, deps, "/oauth2/consent", {
      accept: form.accept === "yes",
      oauth_query: oauthQuery,
    });
    const redirect = await redirectFrom(c, answer);
    return redirect ?? messagePage(c, "Could not finish", EXPIRED, 400);
  });
}
