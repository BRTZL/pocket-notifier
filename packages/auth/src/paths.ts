/**
 * Public paths of the server Worker. Everything it serves lives under `/api` on the
 * deployment's origin (`BETTER_AUTH_URL`), except the OAuth discovery documents, which
 * MCP clients look up at the origin's root `/.well-known/` (RFC 8414, RFC 9728).
 */
export const API_PREFIX = "/api";

/** better-auth's own routes (its default `basePath`). The OAuth issuer is `<origin>/api/auth`. */
export const AUTH_PATH = `${API_PREFIX}/auth`;

/** The MCP endpoint, which is also the OAuth protected resource. */
export const MCP_PATH = `${API_PREFIX}/mcp`;

/** The Worker's own sign-in and consent pages for MCP clients (`apps/server`). */
export const OAUTH_LOGIN_PATH = `${API_PREFIX}/oauth/login`;
export const OAUTH_CONSENT_PATH = `${API_PREFIX}/oauth/consent`;
