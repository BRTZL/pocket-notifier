/**
 * The one place a feature is found or created for a message. Every publish path (REST,
 * app API, MCP) goes through `ensureFeature`, so the same conversation always lands in
 * the same feature and the same thread key, `c:<slug>`.
 */
import { FEATURE_LIMITS, FeatureSlug, slugify } from "@notifier/contract/feature";
import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { feature } from "@notifier/db/schema/notifier";
import { and, eq } from "drizzle-orm";

type FeatureRow = typeof feature.$inferSelect;

/** How many `-2`, `-3` … suffixes are tried before giving up. */
const MAX_SUFFIX = 50;
const TRAILING_DASHES = /-+$/u;

type Ensured = { feature: FeatureRow; created: boolean };

async function findBySlug(
  db: Database,
  projectId: string,
  slug: string,
): Promise<FeatureRow | undefined> {
  const [row] = await db
    .select()
    .from(feature)
    .where(and(eq(feature.projectId, projectId), eq(feature.slug, slug)))
    .limit(1);
  return row;
}

/** `base` with `-<n>` appended, cut so the result still fits a slug. */
function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  const head = base
    .slice(0, FEATURE_LIMITS.slugLength - suffix.length)
    .replace(TRAILING_DASHES, "");
  return `${head}${suffix}`;
}

type SlugClaim = {
  projectId: string;
  slug: string;
  name: string;
  userId: string | null;
  /** Whether an existing feature at `slug` is the one wanted. */
  accepts: (existing: FeatureRow) => boolean;
};

/**
 * The feature at `claim.slug`: the existing one when `accepts` it, else a new one when the
 * slug is free. `undefined` when the slug belongs to a feature that is not wanted. Retries
 * once when a concurrent insert takes the slug between the read and the insert.
 */
async function claimSlug(
  db: Database,
  claim: SlugClaim,
  retry = true,
): Promise<Ensured | undefined> {
  const existing = await findBySlug(db, claim.projectId, claim.slug);
  if (existing) {
    return claim.accepts(existing) ? { feature: existing, created: false } : undefined;
  }
  const [inserted] = await db
    .insert(feature)
    .values({
      id: newId("feature"),
      projectId: claim.projectId,
      slug: claim.slug,
      name: claim.name,
      createdBy: claim.userId,
    })
    .onConflictDoNothing({ target: [feature.projectId, feature.slug] })
    .returning();
  if (inserted) {
    return { feature: inserted, created: true };
  }
  if (!retry) {
    throw new Error("feature insert returned no row");
  }
  return await claimSlug(db, claim, false);
}

/**
 * The feature of `projectId` for a conversation named `key`, created when missing.
 *
 * - `key` that is a valid feature slug once trimmed and lowercased (`[a-z0-9][a-z0-9-]{0,62}`):
 *   that slug. An existing feature with it is reused as it is, whatever its name.
 * - Any other `key` (e.g. `org/repo`): `slugify(key)` (`org-repo`). An existing feature
 *   there is reused when its name matches `key` or `name` (any case); otherwise `-2`, `-3`
 *   … is appended until a free or matching slug is found.
 *
 * A new feature is named `name` (cut to the feature name limit).
 */
export async function ensureFeature(
  db: Database,
  args: { projectId: string; key: string; name: string; userId: string | null },
): Promise<Ensured> {
  const name = (args.name.trim() || args.key.trim()).slice(0, FEATURE_LIMITS.nameLength);
  const normalized = args.key.trim().toLowerCase();
  const claim = { projectId: args.projectId, name, userId: args.userId };

  if (FeatureSlug.safeParse(normalized).success) {
    const found = await claimSlug(db, { ...claim, slug: normalized, accepts: () => true });
    if (!found) {
      throw new Error("feature insert returned no row");
    }
    return found;
  }

  const sameNames = new Set([normalized, name.toLowerCase()]);
  const accepts = (existing: FeatureRow) => sameNames.has(existing.name.toLowerCase());
  const base = slugify(args.key);
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const slug = n === 1 ? base : withSuffix(base, n);
    // biome-ignore lint/performance/noAwaitInLoops: each slug is tried only after the previous one is taken.
    const found = await claimSlug(db, { ...claim, slug, accepts });
    if (found) {
      return found;
    }
  }
  throw new Error(`no free feature slug for "${args.key}"`);
}

/** Marks a message at `at` as the feature's latest activity. */
export async function touchFeature(db: Database, featureId: string, at: Date): Promise<void> {
  await db.update(feature).set({ lastMessageAt: at }).where(eq(feature.id, featureId));
}
