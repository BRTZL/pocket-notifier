import type { Context as ApiContext } from "@notifier/api/context";
import type { Database } from "@notifier/db";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { isPublicApiPath, isPublicPath } from "../src/boundary";

const APP_ORIGIN = "http://web.test";
const MAX_BYTES = 64 * 1024;

function setup() {
  const deps = {
    appOrigin: APP_ORIGIN,
    identifyUser: vi.fn(async () => false),
    authHandler: vi.fn(async () => new Response(null, { status: 204 })),
    getDb: vi.fn(() => ({}) as Database),
    createDispatch: vi.fn(async () => ({ messagePublished: vi.fn(), messagesRead: vi.fn() })),
    createContext: vi.fn(async () => ({}) as ApiContext),
    oauthPages: {
      authOrigin: "http://localhost:3000",
      authHandler: vi.fn(async () => new Response(null, { status: 204 })),
      getSessionUser: vi.fn(async () => null),
      verifyOAuthQuery: vi.fn(async () => false),
      findClient: vi.fn(async () => null),
    },
    mcp: vi.fn(async () => new Response(null, { status: 401 })),
  };
  return { app: createApp(deps), deps };
}

/** `[Allow-Origin, Allow-Credentials]`; public CORS is `["*", null]`. */
function corsOf(response: Response) {
  return [
    response.headers.get("Access-Control-Allow-Origin"),
    response.headers.get("Access-Control-Allow-Credentials"),
  ];
}

const PUBLIC_CORS = ["*", null];

describe("isPublicApiPath", () => {
  it("covers /v1 and everything under it, nothing else", () => {
    expect(isPublicApiPath("/v1")).toBe(true);
    expect(isPublicApiPath("/v1/")).toBe(true);
    expect(isPublicApiPath("/v1/projects/x/messages")).toBe(true);
    expect(isPublicApiPath("/v10")).toBe(false);
    expect(isPublicApiPath("/v1x/docs")).toBe(false);
    expect(isPublicApiPath("/rpc/v1/x")).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("adds the MCP endpoint and the cookie-less OAuth endpoints, not sign-in or consent", () => {
    for (const path of [
      "/v1/projects/x/messages",
      "/mcp",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server/api/auth",
      "/api/auth/oauth2/register",
      "/api/auth/oauth2/token",
      "/api/auth/jwks",
    ]) {
      expect(isPublicPath(path)).toBe(true);
    }
    for (const path of [
      "/mcpx",
      "/oauth/login",
      "/oauth/consent",
      "/api/auth/oauth2/authorize",
      "/api/auth/oauth2/consent",
      "/api/auth/sign-in/email",
      "/rpc/me/get",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("MCP and OAuth boundary", () => {
  it("serves /mcp and discovery with public CORS and no session lookup", async () => {
    const { app, deps } = setup();
    const preflight = await app.request("/mcp", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST", Origin: "https://agent.example" },
    });
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Mcp-Protocol-Version");

    const call = await app.request("/mcp", {
      method: "POST",
      headers: { Origin: APP_ORIGIN, Cookie: "better-auth.session_token=abc" },
    });
    expect(call.status).toBe(401);
    expect(call.headers.get("Access-Control-Expose-Headers")).toContain("WWW-Authenticate");
    expect(deps.mcp).toHaveBeenCalledTimes(1);

    const discovery = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(discovery.status).toBe(204);
    expect(deps.authHandler).toHaveBeenCalledTimes(1);
    expect(deps.identifyUser).not.toHaveBeenCalled();
    expect(deps.createContext).not.toHaveBeenCalled();
  });

  it("refuses sign-in and consent form posts from other origins", async () => {
    const { app, deps } = setup();
    for (const path of ["/oauth/login", "/oauth/consent"]) {
      const response = await app.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://evil.example",
        },
        body: "oauth_query=x&accept=yes",
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    }
    expect(deps.oauthPages.authHandler).not.toHaveBeenCalled();
  });
});

describe("public API boundary", () => {
  const preflight = { "Access-Control-Request-Method": "POST", Origin: APP_ORIGIN };

  it("answers /v1 and its routes with public CORS only, even from the app origin", async () => {
    const { app, deps } = setup();
    const bare = await app.request("/v1", { method: "OPTIONS", headers: preflight });
    expect(corsOf(bare)).toEqual(PUBLIC_CORS);
    const nested = await app.request("/v1/projects/x/messages", {
      method: "OPTIONS",
      headers: preflight,
    });
    expect(corsOf(nested)).toEqual(PUBLIC_CORS);

    const get = await app.request("/v1", { headers: { Origin: APP_ORIGIN, Cookie: "s=1" } });
    expect(get.status).toBe(404);
    expect(corsOf(get)).toEqual(PUBLIC_CORS);
    expect(deps.identifyUser).not.toHaveBeenCalled();
    expect(deps.createContext).not.toHaveBeenCalled();
  });

  it("never looks up a session for public requests with cookies", async () => {
    const { app, deps } = setup();
    const response = await app.request("/v1/projects/x/messages", {
      headers: { Origin: APP_ORIGIN, Cookie: "better-auth.session_token=abc" },
    });
    expect(response.status).toBe(401);
    expect(corsOf(response)).toEqual(PUBLIC_CORS);
    expect(deps.identifyUser).not.toHaveBeenCalled();
    expect(deps.createContext).not.toHaveBeenCalled();
  });

  it("keeps credentialed CORS and session handling for the app API", async () => {
    const { app, deps } = setup();
    const response = await app.request("/rpc/me/get", { method: "OPTIONS", headers: preflight });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    await app.request("/");
    expect(deps.identifyUser).toHaveBeenCalled();
  });

  it("refuses oversized bodies with 413 before parsing", async () => {
    const { app } = setup();
    const declared = await app.request("/v1/projects/x/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(MAX_BYTES + 1) },
      body: "{}",
    });
    expect(declared.status).toBe(413);
    expect(corsOf(declared)).toEqual(PUBLIC_CORS);
    expect(await declared.json()).toEqual({
      defined: true,
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      message: "Payload too large",
      data: { maxBytes: MAX_BYTES },
    });

    // No Content-Length: the body is counted while it streams.
    const chunk = new Uint8Array(16 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = await app.request("/v1/projects/x/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
    // Reading stopped right after passing the cap instead of draining the stream.
    expect(sent).toBeLessThanOrEqual(MAX_BYTES + 3 * chunk.byteLength);
  });
});
