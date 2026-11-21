import { z } from "zod";

import { IconUrl } from "./avatar";
import { idSchema, Timestamp, UserSummary } from "./common";
import { Priority } from "./priority";

export const ProjectId = idSchema("project");

/**
 * Project names are unique per deployment and appear in publish URLs:
 * lowercase letters, digits, `-` and `_`, starting with a letter or digit.
 */
export const ProjectName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u, "Use lowercase letters, digits, '-' or '_'");

export const RETENTION_DAYS = { default: 30, min: 1, max: 365 } as const;

/**
 * Days to keep a project's messages. No `.default()` here: update inputs must be able
 * to tell "not given" apart from 30. Creation falls back to `RETENTION_DAYS.default`.
 */
export const RetentionDays = z.number().int().min(RETENTION_DAYS.min).max(RETENTION_DAYS.max);

/**
 * - `owner`: manages the project and its members, publishes, subscribes.
 * - `publisher`: publishes and reads history.
 * - `subscriber`: reads history and receives pushes.
 */
export const ProjectRole = z.enum(["owner", "publisher", "subscriber"]);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const Project = z.object({
  id: ProjectId,
  name: ProjectName,
  displayName: z.string().min(1).max(80).nullable(),
  description: z.string().max(500).nullable(),
  /**
   * The project's icon: an uploaded image served from this deployment under
   * `/api/icons/...`, or any HTTPS URL an owner set. `null` draws generated initials.
   * Plain `http` only for uploads on a local deployment (`http://localhost:3300`); what
   * owners set is always HTTPS (`IconUrl` on the inputs).
   */
  iconUrl: z
    .url({ protocol: /^https?$/u })
    .max(2048)
    .nullable(),
  defaultPriority: Priority,
  retentionDays: RetentionDays,
  createdAt: Timestamp,
});
export type Project = z.infer<typeof Project>;

/** A project as seen by the signed-in user. */
export const MyProject = Project.extend({
  role: ProjectRole,
  /** Whether this user's devices receive pushes for the project. */
  subscribed: z.boolean(),
  /** Subscribed but silenced: messages land in the inbox without a push. */
  muted: z.boolean(),
  unreadCount: z.number().int().min(0),
  lastMessageAt: Timestamp.nullable(),
  /**
   * The caller's personal "General" project: notifications sent without a project land
   * here. Private (owner only, no members or invites) and never deleted.
   */
  personal: z.boolean(),
});
export type MyProject = z.infer<typeof MyProject>;

export const CreateProjectInput = z.object({
  name: ProjectName,
  displayName: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  iconUrl: IconUrl.optional(),
  defaultPriority: Priority.optional(),
  retentionDays: RetentionDays.optional(),
});

export const UpdateProjectInput = z.object({
  id: ProjectId,
  displayName: z.string().min(1).max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  /** `null` removes the icon (and deletes an uploaded one). Owners only. */
  iconUrl: IconUrl.nullable().optional(),
  defaultPriority: Priority.optional(),
  retentionDays: RetentionDays.optional(),
});

/** Image types accepted for an uploaded project icon. */
export const ProjectIconContentType = z.enum(["image/png", "image/jpeg", "image/webp"]);
export type ProjectIconContentType = z.infer<typeof ProjectIconContentType>;

/** Largest uploaded icon, decoded. Apps resize to a 256 px square before uploading. */
export const PROJECT_ICON_MAX_BYTES = 256 * 1024;

/**
 * Upload a project icon (owners only). The image is base64 in JSON so the React Native
 * client needs no multipart or `File` support. The server checks the bytes match
 * `contentType`, stores the image and sets `iconUrl` to its `/api/icons/...` URL.
 */
export const SetProjectIconInput = z.object({
  id: ProjectId,
  contentType: ProjectIconContentType,
  /** Base64 (standard alphabet, padded) of at most `PROJECT_ICON_MAX_BYTES` bytes. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil(PROJECT_ICON_MAX_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u, "Must be base64"),
});

export const ProjectMember = z.object({
  projectId: ProjectId,
  user: UserSummary,
  role: ProjectRole,
  addedAt: Timestamp,
});
export type ProjectMember = z.infer<typeof ProjectMember>;

export const AddMemberInput = z.object({
  projectId: ProjectId,
  /** Email of an existing user. New people join through an invite first. */
  email: z.email(),
  role: ProjectRole.exclude(["owner"]),
});

export const UpdateMemberInput = z.object({
  projectId: ProjectId,
  userId: z.string().min(1),
  role: ProjectRole,
});

export const SubscriptionInput = z.object({
  projectId: ProjectId,
  subscribed: z.boolean(),
  muted: z.boolean().default(false),
});
