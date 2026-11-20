/**
 * The URLs MCP clients and scripts see in production: with `BETTER_AUTH_URL` set to the
 * deployment's origin, every advertised URL carries the `/api` prefix, while discovery
 * stays at the origin's root `/.well-known/` where RFC 8414 / RFC 9728 clients look.
 */

import type { Dispatch } from "@notifier/api/dispatch";
import { findOAuthClient, handleMcpRequest } from "@notifier/api/mcp/handler";
import { createAuth, protectMcp, verifyOAuthQuery } from "@notifier/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../packages/api/test/db";
import { createApp } from "../src/app";

const ORIGIN = "https://notifier.bartuozel.com";
const ENV = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  CORS_ORIGIN: ORIGIN,
};

describe("production URLs", () => {
  let testDb: TestDb;
  let app: ReturnType<typeof createApp>;

  const fetchApp = (path: string, init?: RequestInit) =>
    app.fetch(new Request(new URL(path, ORIGIN), init));

  beforeAll(async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const auth = createAuth(ENV, db);
    const dispatch: Dispatch = { messagePublished: () => undefined, messagesRead: () => undefined };
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
        authOrigin: ORIGIN,
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
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("challenges /api/mcp with the root protected-resource metadata URL", async () => {
    const response = await fetchApp("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  });

  it("advertises /api/mcp as the resource and /api/auth as the issuer", async () => {
    const resource = await fetchApp("/.well-known/oauth-protected-resource/api/mcp");
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [`${ORIGIN}/api/auth`],
    });

    const metadata = await fetchApp("/.well-known/oauth-authorization-server/api/auth");
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      jwks_uri: `${ORIGIN}/api/auth/jwks`,
    });
  });

  it("sends authorization without a session to the /api sign-in page", async () => {
    const registered = await fetchApp("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Prod Client",
        redirect_uris: ["http://127.0.0.1:33418/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };

    const authorize = new URL(`${ORIGIN}/api/auth/oauth2/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:33418/callback",
      scope: "notifier:read notifier:write offline_access",
      state: "s",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      resource: `${ORIGIN}/api/mcp`,
    }).toString();
    const redirect = await app.fetch(
      new Request(authorize, { headers: { Accept: "text/html" }, redirect: "manual" }),
    );
    expect(redirect.status).toBe(302);
    const location = redirect.headers.get("Location") ?? "";
    expect(location.startsWith("/api/oauth/login?")).toBe(true);
    expect((await fetchApp(location)).status).toBe(200);
  });

  it("serves health, the REST API reference and its spec under /api", async () => {
    const health = await fetchApp("/api/health");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("OK");
    expect((await fetchApp("/")).status).toBe(404);

    const unauthorized = await fetchApp("/api/v1/projects/x/messages");
    expect(unauthorized.status).toBe(401);

    const spec = await fetchApp("/api/v1/spec.json");
    expect(spec.status).toBe(200);
    // Paths stay `/v1/...`; the server URL carries the `/api` prefix.
    const document = (await spec.json()) as { servers: { url: string }[]; paths: object };
    expect(document.servers).toEqual([{ url: `${ORIGIN}/api` }]);
    expect(Object.keys(document.paths)).toContain("/v1/projects/{project}/messages");
    expect((await fetchApp("/api/v1/docs")).status).toBe(200);
  });
});
