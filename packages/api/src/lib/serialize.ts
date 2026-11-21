import type { UserSummary } from "@notifier/contract/common";
import type { Device } from "@notifier/contract/device";
import type { Invite } from "@notifier/contract/invite";
import type { MyProject, ProjectMember, ProjectRole } from "@notifier/contract/project";
import type { MessageResponse } from "@notifier/contract/response";
import type { AccessToken, TokenScope } from "@notifier/contract/token";
import type {
  accessToken,
  device,
  invite,
  messageResponse,
  project,
} from "@notifier/db/schema/notifier";

type UserRow = {
  id: string;
  name: string;
  email: string;
  image?: string | null | undefined;
};

/**
 * better-auth accepts any string as `user.image` (e.g. a relative path), while the
 * contract requires an absolute URL. Drop values that are not, instead of failing
 * output validation for every response that includes the user.
 */
function absoluteUrlOrNull(value: string | null | undefined): string | null {
  return value && URL.canParse(value) ? value : null;
}

export function toUserSummary(row: UserRow): UserSummary {
  return { id: row.id, name: row.name, email: row.email, image: absoluteUrlOrNull(row.image) };
}

export type ProjectStats = {
  unreadCount: number;
  lastMessageAt: Date | null;
};

export function toMyProject(
  row: typeof project.$inferSelect,
  membership: { role: ProjectRole; subscribed: boolean; muted: boolean },
  stats: ProjectStats,
): MyProject {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    iconUrl: row.iconUrl,
    defaultPriority: row.defaultPriority,
    retentionDays: row.retentionDays,
    createdAt: row.createdAt.toISOString(),
    role: membership.role,
    subscribed: membership.subscribed,
    muted: membership.muted,
    unreadCount: stats.unreadCount,
    lastMessageAt: stats.lastMessageAt?.toISOString() ?? null,
    // Only its owner is ever a member of a personal project.
    personal: row.personalUserId !== null,
  };
}

export function toProjectMember(row: {
  projectId: string;
  role: ProjectRole;
  addedAt: Date;
  user: UserRow;
}): ProjectMember {
  return {
    projectId: row.projectId,
    user: toUserSummary(row.user),
    role: row.role,
    addedAt: row.addedAt.toISOString(),
  };
}

export function toAccessToken(
  row: typeof accessToken.$inferSelect,
  scope: TokenScope,
): AccessToken {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    scope,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvite(
  row: typeof invite.$inferSelect & { creator: UserRow; acceptor: UserRow | null },
  grants: Invite["grants"],
): Invite {
  return {
    id: row.id,
    email: row.email,
    grants,
    createdBy: toUserSummary(row.creator),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    acceptedBy: row.acceptor ? toUserSummary(row.acceptor) : null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMessageResponse(
  row: typeof messageResponse.$inferSelect,
  responder: UserRow,
): MessageResponse {
  return {
    id: row.id,
    messageId: row.messageId,
    actionKey: row.actionKey,
    kind: row.kind,
    text: row.text,
    user: toUserSummary(responder),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDevice(row: typeof device.$inferSelect): Device {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    appVersion: row.appVersion,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
