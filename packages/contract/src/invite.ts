import { z } from "zod";

import { idSchema, Timestamp, UserSummary } from "./common";
import { ProjectId, ProjectRole } from "./project";

export const InviteId = idSchema("invite");

/** The code is the secret part of the invite link `<web>/invite/<code>`. */
export const InviteCode = z.string().regex(/^[0-9A-Za-z]{24}$/u);

export const InviteProjectGrant = z.object({
  projectId: ProjectId,
  role: ProjectRole.exclude(["owner"]),
});

export const Invite = z.object({
  id: InviteId,
  /** When set, only this email can accept the invite. */
  email: z.email().nullable(),
  /** Project memberships granted when the invite is accepted. */
  grants: z.array(InviteProjectGrant),
  createdBy: UserSummary,
  expiresAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
  acceptedBy: UserSummary.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Invite = z.infer<typeof Invite>;

export const CreateInviteInput = z.object({
  email: z.email().optional(),
  grants: z.array(InviteProjectGrant).max(50).default([]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const CreateInviteOutput = z.object({
  invite: Invite,
  code: InviteCode,
  url: z.url(),
});

/** What the sign-up page may show before the person has an account. */
export const InvitePreview = z.object({
  invitedBy: z.string(),
  email: z.email().nullable(),
  projects: z.array(z.string()),
  expiresAt: Timestamp,
});
