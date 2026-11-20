import type { Feature, FeatureStatus } from "@notifier/contract/feature";

const STATUS_ORDER: Record<FeatureStatus, number> = { active: 0, done: 1, archived: 2 };

/**
 * Active features first, then done, then archived. Within a status the order stays as
 * `features.list` returns it: most recent activity first.
 */
export function sortFeatures(features: readonly Feature[]): Feature[] {
  return features
    .map((feature, index) => ({ feature, index }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.feature.status] - STATUS_ORDER[b.feature.status] || a.index - b.index,
    )
    .map(({ feature }) => feature);
}
