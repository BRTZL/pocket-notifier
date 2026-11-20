import type { Invite } from "@notifier/contract/invite";

export type InviteStatus = "open" | "accepted" | "revoked" | "expired";

/** Where an invite stands now; accepted and revoked win over an expiry that passed later. */
export function inviteStatus(invite: Invite, now = Date.now()): InviteStatus {
  if (invite.acceptedAt) {
    return "accepted";
  }
  if (invite.revokedAt) {
    return "revoked";
  }
  return new Date(invite.expiresAt).getTime() <= now ? "expired" : "open";
}
