import type { AccessToken } from "@notifier/contract/token";

import { relativeTime, shortDate } from "@/lib/format";

/** "All projects you publish to" or the project names. */
export function scopeSummary(scope: AccessToken["scope"]): string {
  return scope.kind === "all" ? "All your projects" : scope.projects.join(", ");
}

/** Expiry and last use on one line, e.g. "Expires 12/20/2026 · used 3h ago". */
export function tokenUsage(token: AccessToken, now = Date.now()): string {
  let expiry = "Never expires";
  if (token.expiresAt) {
    const expired = new Date(token.expiresAt).getTime() <= now;
    expiry = `${expired ? "Expired" : "Expires"} ${shortDate(token.expiresAt)}`;
  }
  const used = token.lastUsedAt ? `used ${relativeTime(token.lastUsedAt, now)} ago` : "never used";
  return `${expiry} · ${used}`;
}
