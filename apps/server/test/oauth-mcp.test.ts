/**
 * The OAuth flow an MCP client (Claude Code, Codex) runs, end to end in-process against
 * the real app, auth and a Miniflare D1: discovery, dynamic client registration, PKCE
 * authorization through the sign-in and consent pages, code exchange, then MCP calls
 * with the bearer token.
 */

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Dispatch } from "@notifier/api/dispatch";
import { findOAuthClient, handleMcpRequest } from "@notifier/api/mcp/handler";
import { createAuth, protectMcp, verifyOAuthQuery } from "@notifier/auth";
import { message } from "@notifier/db/schema/notifier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../packages/api/test/db";
import { createApp } from "../src/app";

type Message = Parameters<Dispatch["messagePublished"]>[0];

const BASE = "http://localhost:3000";
const ENV = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  CORS_ORIGIN: "http://web.test",
};
const EMAIL = "ada@example.com";
const PASSWORD = "correct horse battery";
const REGISTERED_REDIRECT = "http://127.0.0.1:33418/callback";
// Native loopback clients may pick another port at authorization time (RFC 8252).
const USED_REDIRECT = "http://127.0.0.1:40123/callback";

async function pkcePair() {
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return { verifier, challenge };
}

/** The `name=value` pairs of `Set-Cookie` headers, as a `Cookie` header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("OAuth for MCP clients, end to end", () => {
  let testDb: TestDb;
  let app: ReturnType<typeof createApp>;
  const published: Message[] = [];

  async function fetchApp(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(new URL(input, BASE), init);
    return await app.fetch(request);
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const auth = createAuth(ENV, db);
    const dispatch = {
      messagePublished: (item: Message) => {
        published.push(item);
      },
      messagesRead: () => undefined,
    };
    app = createApp({
      appOrigin: ENV.CORS_ORIGIN,
      identifyUser: async () => undefined,
      authHandler: (request) => auth.handler(request),
      getDb: () => db,
      createDispatch: async () => dispatch,
      createContext: async (c) => ({
        db,
        session: await auth.api.getSession({ headers: c.req.raw.headers }),
        appUrl: ENV.CORS_ORIGIN,
        dispatch,
      }),
      oauthPages: {
        authOrigin: BASE,
        authHandler: (request) => auth.handler(request),
        getSessionUser: async (headers) => (await auth.api.getSession({ headers }))?.user ?? null,
        verifyOAuthQuery: (query) => verifyOAuthQuery(ENV, query),
        findClient: (clientId) => findOAuthClient(db, clientId),
      },
      mcp: (c) =>
        protectMcp(auth, ENV, (request, claims) =>
          handleMcpRequest(request, claims, { db, dispatch }),
        )(c.req.raw),
    });
    // The first account of a fresh deployment needs no invite.
    await auth.api.signUpEmail({ body: { name: "Ada", email: EMAIL, password: PASSWORD } });
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("asks unauthenticated MCP calls to sign in via protected-resource metadata", async () => {
    const response = await fetchApp("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'scope="notifier:read notifier:write offline_access"',
    );

    const forged = await fetchApp("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-token", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(forged.status).toBe(401);
  });

  it("signs a client in with PKCE and lets it send a notification", async () => {
    // 1. Discovery.
    const resource = (await (
      await fetchApp("/.well-known/oauth-protected-resource/mcp")
    ).json()) as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe(`${BASE}/mcp`);
    const issuer = new URL(resource.authorization_servers[0] ?? "");
    const metadata = (await (
      await fetchApp(`/.well-known/oauth-authorization-server${issuer.pathname}`)
    ).json()) as Record<string, string | string[]>;
    expect(metadata).toMatchObject({
      issuer: `${BASE}/api/auth`,
      code_challenge_methods_supported: ["S256"],
    });

    // 2. Dynamic client registration, as a public client.
    const registered = await fetchApp(String(metadata.registration_endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: [REGISTERED_REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };

    // 3. Authorize without a session: sent to the sign-in page.
    const { verifier, challenge } = await pkcePair();
    const authorizeUrl = new URL(String(metadata.authorization_endpoint));
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: USED_REDIRECT,
      scope: "notifier:read notifier:write offline_access",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: resource.resource,
    }).toString();
    const authorize = await fetchApp(authorizeUrl, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    expect(authorize.status).toBe(302);
    const loginPath = authorize.headers.get("Location") ?? "";
    expect(loginPath.startsWith("/oauth/login?")).toBe(true);

    const loginPage = await fetchApp(loginPath);
    expect(loginPage.status).toBe(200);
    expect(loginPage.headers.get("X-Frame-Options")).toBe("DENY");
    const loginHtml = await loginPage.text();
    expect(loginHtml).toContain("Test Client");
    expect(loginHtml).not.toContain("Sign up");
    const oauthQuery = new URL(loginPath, BASE).search.slice(1);

    // 4. Sign in: a wrong password stays on the page, the right one goes to consent.
    const form = (fields: Record<string, string>) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
      body: new URLSearchParams(fields).toString(),
      redirect: "manual" as const,
    });
    const wrong = await fetchApp(
      "/oauth/login",
      form({ email: EMAIL, password: "nope nope nope", oauth_query: oauthQuery }),
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("Wrong email or password.");
    const tampered = await fetchApp(
      "/oauth/login",
      form({
        email: EMAIL,
        password: PASSWORD,
        oauth_query: oauthQuery.replace("state-1", "state-2"),
      }),
    );
    expect(tampered.status).toBe(400);

    const signedIn = await fetchApp(
      "/oauth/login",
      form({ email: EMAIL, password: PASSWORD, oauth_query: oauthQuery }),
    );
    expect(signedIn.status).toBe(302);
    const consentPath = signedIn.headers.get("Location") ?? "";
    expect(consentPath.startsWith("/oauth/consent?")).toBe(true);
    const cookie = cookiesOf(signedIn);
    expect(cookie).toContain("session_token");

    // 5. Consent.
    const consentPage = await fetchApp(consentPath, { headers: { Cookie: cookie } });
    const consentHtml = await consentPage.text();
    expect(consentHtml).toContain("Allow Test Client?");
    // `form-action` would also block the redirect to the loopback callback after Allow.
    expect(consentPage.headers.get("Content-Security-Policy")).not.toContain("form-action");
    expect(consentPage.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(consentHtml).toContain("127.0.0.1:40123");
    expect(consentHtml).toContain("Send notifications to your phone");
    const consentQuery = new URL(consentPath, BASE).search.slice(1);
    const consented = await fetchApp("/oauth/consent", {
      ...form({ accept: "yes", oauth_query: consentQuery }),
      headers: { ...form({}).headers, Cookie: cookie },
    });
    expect(consented.status).toBe(302);
    const callback = new URL(consented.headers.get("Location") ?? "");
    expect(`${callback.origin}${callback.pathname}`).toBe(USED_REDIRECT);
    expect(callback.searchParams.get("state")).toBe("state-1");
    const code = callback.searchParams.get("code") ?? "";

    // 6. Code exchange.
    const tokenResponse = await fetchApp(String(metadata.token_endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: USED_REDIRECT,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: resource.resource,
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(typeof tokens.refresh_token).toBe("string");
    const accessToken = String(tokens.access_token);

    // 7. MCP with the bearer token.
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      fetch: (input, init) => fetchApp(new Request(input, init)),
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const mcp = new Client({ name: "test", version: "1.0.0" });
    await mcp.connect(transport);
    try {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name)).toContain("send_notification");
      const sent = (await mcp.callTool({
        name: "send_notification",
        arguments: { feature: "OAuth", title: "Signed in", body: "MCP works." },
      })) as { isError?: boolean; structuredContent?: Record<string, unknown> };
      expect(sent.isError).toBeUndefined();
      expect(sent.structuredContent).toMatchObject({
        isGeneral: true,
        feature: { slug: "oauth", created: true },
      });
    } finally {
      await mcp.close();
    }
    expect(published.at(-1)).toMatchObject({
      title: "Signed in",
      sender: { id: client.client_id, name: "Test Client" },
      conversation: { id: "oauth", title: "OAuth" },
    });
    const rows = await testDb.db.select({ sender: message.senderJson }).from(message);
    expect(rows.map((row) => JSON.parse(row.sender ?? "null")?.name)).toContain("Test Client");

    // The refresh token works too.
    const refreshed = await fetchApp(String(metadata.token_endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: String(tokens.refresh_token),
        client_id: client.client_id,
        resource: resource.resource,
      }).toString(),
    });
    expect(refreshed.status).toBe(200);
  });

  async function register(redirectUris: string[]) {
    return await fetchApp("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Loopback Client",
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
  }

  async function authorize(clientId: string, redirectUri: string) {
    const { challenge } = await pkcePair();
    const url = new URL(`${BASE}/api/auth/oauth2/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "notifier:read notifier:write",
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${BASE}/mcp`,
    }).toString();
    return await fetchApp(url, { headers: { Accept: "text/html" }, redirect: "manual" });
  }

  it("accepts localhost and [::1] loopback redirects on any port, and refuses other http hosts", async () => {
    for (const [registered, used] of [
      ["http://localhost:5555/callback", "http://localhost:6666/callback"],
      ["http://[::1]:5555/callback", "http://[::1]:7777/callback"],
    ] as const) {
      const response = await register([registered]);
      expect(response.status).toBe(201);
      const client = (await response.json()) as { client_id: string; application_type: string };
      // Registered without application_type: inferred as a native app from the loopback URI.
      expect(client.application_type).toBe("native");
      const accepted = await authorize(client.client_id, used);
      expect(accepted.status).toBe(302);
      expect(accepted.headers.get("Location")?.startsWith("/oauth/login?")).toBe(true);
      // Another path than the registered one is not the same redirect.
      const otherPath = await authorize(client.client_id, used.replace("/callback", "/other"));
      expect(otherPath.headers.get("Location")?.startsWith("/oauth/login?")).not.toBe(true);
    }

    const evil = await register(["http://evil.example/callback"]);
    expect(evil.status).toBe(400);
  });
});
