import { API_PREFIX, MCP_PATH } from "@notifier/auth/paths";

/** The public REST API (`/api/v1`). */
export const PUBLIC_API_PATH = `${API_PREFIX}/v1`;

/**
 * The public `/api/v1` API authenticates with bearer tokens only: no cookies, no session,
 * any origin. Everything else is the credentialed app boundary. Every place that
 * treats the two differently must use this one check, so `/api/v1` itself is never
 * handled as an app path.
 */
export function isPublicApiPath(path: string): boolean {
  return path === PUBLIC_API_PATH || path.startsWith(`${PUBLIC_API_PATH}/`);
}

/** The MCP endpoint: OAuth bearer tokens only, any origin, never a session. */
export function isMcpPath(path: string): boolean {
  return path === MCP_PATH;
}

/**
 * OAuth endpoints MCP clients call without cookies, possibly from a browser on another
 * origin: discovery documents, signing keys, client registration and the token endpoint.
 * They get public CORS. Authorize, sign-in and consent stay on the credentialed boundary.
 */
const PUBLIC_OAUTH_PATHS = new Set([
  "/api/auth/jwks",
  "/api/auth/oauth2/register",
  "/api/auth/oauth2/token",
  "/api/auth/oauth2/revoke",
  "/api/auth/oauth2/introspect",
]);

export function isPublicOAuthPath(path: string): boolean {
  return (
    path.startsWith("/.well-known/") ||
    path.startsWith("/api/auth/.well-known/") ||
    PUBLIC_OAUTH_PATHS.has(path)
  );
}

/**
 * Project icons, attachment downloads and MCP upload links: capability URLs (an
 * unguessable token, or a content hash for icons), never a session.
 */
const FILE_PATH_PREFIXES = [
  `${API_PREFIX}/icons/`,
  `${API_PREFIX}/attachments/`,
  `${API_PREFIX}/uploads/`,
];

export function isFilePath(path: string): boolean {
  return FILE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The download token in an attachment URL path, for log redaction: the request log
 * records the path, and the token is what makes the URL work.
 */
export const ATTACHMENT_TOKEN_IN_PATH = /(?<=\/api\/attachments\/att_[0-9a-z]{26}\/)[^/?#]+/gu;

/** Paths that take no session and allow any origin without credentials. */
export function isPublicPath(path: string): boolean {
  return isPublicApiPath(path) || isMcpPath(path) || isPublicOAuthPath(path) || isFilePath(path);
}
