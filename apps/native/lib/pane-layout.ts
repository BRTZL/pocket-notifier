/** Material's "medium" window class starts at 600dp: from there the app shows two panes. */
export const TWO_PANE_MIN_WIDTH = 600;

const LIST_PANE_MIN = 320;
const LIST_PANE_MAX = 420;
const LIST_PANE_SHARE = 0.4;

export type PaneLayout = {
  /** Two panes side by side: the list on the left, the selected item on the right. */
  isWide: boolean;
  /** Width of the left (list) pane in dp; 0 on a narrow window. */
  listWidth: number;
};

/** The pane layout for a window `width` dp wide (a folded or unfolded Fold, a tablet). */
export function paneLayout(width: number): PaneLayout {
  if (width < TWO_PANE_MIN_WIDTH) {
    return { isWide: false, listWidth: 0 };
  }
  const listWidth = Math.round(
    Math.min(LIST_PANE_MAX, Math.max(LIST_PANE_MIN, width * LIST_PANE_SHARE)),
  );
  return { isWide: true, listWidth };
}
