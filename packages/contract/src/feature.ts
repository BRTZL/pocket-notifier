import { z } from "zod";

import { idSchema, Timestamp } from "./common";
import { ProjectId } from "./project";

/**
 * Features. A feature is a named workstream inside a project, e.g. "Improving performance"
 * in `rezme`. In the app a feature is a conversation: messages sent to it
 * carry `conversation = { id: slug, title: name }`, so its key is `c:<slug>`.
 */
export const FeatureId = idSchema("feature");

export const FEATURE_LIMITS = {
  nameLength: 64,
  slugLength: 63,
  descriptionLength: 500,
} as const;

/** Unique per project: lowercase letters, digits and `-`, starting with a letter or digit. */
export const FeatureSlug = z
  .string()
  .min(1)
  .max(FEATURE_LIMITS.slugLength)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/u,
    "Use lowercase letters, digits or '-', starting with a letter or digit",
  );

/** Same cap as `Conversation.title`, which shows it. */
export const FeatureName = z.string().trim().min(1).max(FEATURE_LIMITS.nameLength);

/**
 * - `active`: being worked on; the default.
 * - `done`: finished.
 * - `archived`: put away.
 *
 * Only owners change it. Sending a message never changes it, so "feature shipped" can be
 * sent right after marking a feature done.
 */
export const FeatureStatus = z.enum(["active", "done", "archived"]);
export type FeatureStatus = z.infer<typeof FeatureStatus>;

export const Feature = z.object({
  id: FeatureId,
  projectId: ProjectId,
  slug: FeatureSlug,
  name: z.string().min(1).max(FEATURE_LIMITS.nameLength),
  description: z.string().max(FEATURE_LIMITS.descriptionLength).nullable(),
  status: FeatureStatus,
  /** The feature's conversation key in its project, `c:<slug>`. */
  conversationKey: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastMessageAt: Timestamp.nullable(),
});
export type Feature = z.infer<typeof Feature>;

export const ListFeaturesInput = z.object({
  projectId: ProjectId,
  /** Only features with this status. Omitted: every status. */
  status: FeatureStatus.optional(),
});

export const CreateFeatureInput = z.object({
  projectId: ProjectId,
  name: FeatureName,
  /** Derived from `name` when omitted. An existing slug returns that feature unchanged. */
  slug: FeatureSlug.optional(),
  description: z.string().max(FEATURE_LIMITS.descriptionLength).optional(),
});

export const UpdateFeatureStatusInput = z.object({
  id: FeatureId,
  status: FeatureStatus,
});

const TURKISH_DOTLESS = /[ıİ]/gu;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_SLUG = /[^a-z0-9]+/gu;
const EDGE_DASHES = /^-+|-+$/gu;

/** FNV-1a of `text` as 8 hex chars, for names that leave no slug characters (e.g. emoji). */
function shortHash(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (const char of text) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is defined with XOR.
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: converts the hash to an unsigned 32-bit integer.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The slug for a feature name: lowercase ASCII letters and digits joined by `-`, accents
 * removed ("Çok hızlı" becomes `cok-hizli`), at most 63 chars. A name without any such
 * characters gets `f-<hash>`, so the same name always maps to the same slug.
 */
export function slugify(name: string): string {
  const slug = name
    .replace(TURKISH_DOTLESS, "i")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_SLUG, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, FEATURE_LIMITS.slugLength)
    .replace(EDGE_DASHES, "");
  return slug.length > 0 ? slug : `f-${shortHash(name.trim())}`;
}
