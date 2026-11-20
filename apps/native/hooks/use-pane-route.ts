import { type Href, router, useGlobalSearchParams, useSegments } from "expo-router";

export type PaneRoute = {
  /** Route segments inside the tab's group, e.g. `["conversation", "[projectId]", "[key]"]`. */
  path: string[];
  /** The focused screen's params, decoded. */
  params: Record<string, string | undefined>;
};

/**
 * The screen the tab's stack shows, for a list pane drawn by the tab's layout (a layout
 * cannot read its child screen's params). `null` while another tab is focused: global
 * params follow the focused screen, and the hidden tabs stay mounted.
 */
export function usePaneRoute(group: `(${string})`): PaneRoute | null {
  const segments = useSegments() as string[];
  const raw = useGlobalSearchParams();
  if (segments[1] !== group) {
    return null;
  }
  const params: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(raw)) {
    params[name] = Array.isArray(value) ? value[0] : value;
  }
  return { path: segments.slice(2), params };
}

/**
 * Opens a list pane's selection in the right pane: in place of the item shown there, or
 * on top of the placeholder. Back then always clears the right pane instead of walking
 * through every item opened before.
 */
export function openInPane(href: Href, { isDetailOpen }: { isDetailOpen: boolean }) {
  if (isDetailOpen) {
    router.replace(href);
  } else {
    router.push(href);
  }
}
