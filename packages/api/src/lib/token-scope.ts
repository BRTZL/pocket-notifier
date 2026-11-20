import { TokenScope } from "@notifier/contract/token";

/** Parses `access_token.scope_json`; `null` when the stored value is unreadable. */
export function parseTokenScope(json: string): TokenScope | null {
  try {
    const parsed = TokenScope.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Duplicate project names are dropped so the stored scope stays canonical. */
export function normalizeTokenScope(scope: TokenScope): TokenScope {
  return scope.kind === "all"
    ? scope
    : { kind: "projects", projects: [...new Set(scope.projects)] };
}

export const DAY_MS = 86_400_000;
