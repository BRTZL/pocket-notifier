import { useWindowDimensions } from "react-native";

import { type PaneLayout, paneLayout } from "@/lib/pane-layout";

/**
 * One pane or two, from the window width; it follows folding, unfolding and rotation
 * live. Only the layout changes: each tab keeps one navigation stack in both, so the
 * open thread and its draft survive the switch.
 */
export function usePaneLayout(): PaneLayout {
  const { width } = useWindowDimensions();
  return paneLayout(width);
}
