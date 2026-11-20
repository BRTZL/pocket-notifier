const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const WEB = /^https?:/iu;
const QUERY_OR_FRAGMENT = /[?#]/u;
const LEADING_SLASHES = /^\/+/u;
const DYNAMIC_SEGMENT = /^\[(\w+)\]$/u;

/**
 * The app path of an incoming link, still percent-encoded: after `/--/` for Expo Go
 * (`exp://host:port/--/conversation/…`), else everything after the app scheme
 * (`notifier://conversation/…`). `null` for web links and anything else.
 */
export function linkPath(url: string): string | null {
  const expoGo = url.indexOf("/--/");
  let path: string;
  if (expoGo !== -1) {
    path = url.slice(expoGo + "/--".length);
  } else if (SCHEME.test(url) && !WEB.test(url)) {
    path = `/${url.replace(SCHEME, "").replace(LEADING_SLASHES, "")}`;
  } else {
    return null;
  }
  return path.split(QUERY_OR_FRAGMENT)[0] || "/";
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The signed-in routes a link can point at, with their dynamic segments. A replay goes
 * through `{ pathname, params }`, so a param that contains `/` (a conversation key like
 * `c:org/repo`) stays one param: a string href would be split at its decoded `/`.
 */
const LINK_ROUTES = [
  "/conversation/[projectId]/[key]",
  "/project/[projectId]",
  "/project/[projectId]/settings",
  "/project/[projectId]/message/[id]",
  "/project/[projectId]/conversation/[key]",
] as const;

export type ReplayTarget =
  | { pathname: (typeof LINK_ROUTES)[number]; params: Record<string, string> }
  | string;

/** Matches encoded path segments against a route template; params come out decoded. */
function matchRoute(template: string, segments: string[]): Record<string, string> | null {
  const parts = template.split("/").filter(Boolean);
  if (parts.length !== segments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, part] of parts.entries()) {
    const segment = segments[index] ?? "";
    const name = DYNAMIC_SEGMENT.exec(part)?.[1];
    if (name) {
      params[name] = decodeSegment(segment);
    } else if (decodeSegment(segment) !== part) {
      return null;
    }
  }
  return params;
}

/**
 * What to replay later for the route now shown at `pathname` (decoded, as the router
 * reports it). A decoded path loses which `/` were inside a segment, so the incoming
 * link's encoded path is matched against the app's link routes when it leads to the
 * same place; anything else replays as the path itself.
 */
export function replayTarget(pathname: string, url: string | null): ReplayTarget {
  const encoded = url ? linkPath(url) : null;
  if (encoded) {
    const segments = encoded.split("/").filter(Boolean);
    if (`/${segments.map(decodeSegment).join("/")}` === pathname) {
      for (const route of LINK_ROUTES) {
        const params = matchRoute(route, segments);
        if (params) {
          return { pathname: route, params };
        }
      }
    }
  }
  return pathname;
}
