/**
 * The public `/v1` API authenticates with bearer tokens only: no cookies, no session,
 * any origin. Everything else is the credentialed app boundary. Every place that
 * treats the two differently must use this one check, so `/v1` itself is never
 * handled as an app path.
 */
export function isPublicApiPath(path: string): boolean {
  return path === "/v1" || path.startsWith("/v1/");
}
