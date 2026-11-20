import { Separator } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/query-state";
import { usePaneLayout } from "@/hooks/use-pane-layout";

/**
 * A tab's frame: on a wide window the list pane (`list`) on the left, a hairline, and
 * `children` (the tab's stack) on the right; on a narrow one only `children`.
 *
 * The stack always sits at the same place in the tree, so switching between one pane
 * and two (folding, unfolding) never remounts it: the open screen, its scroll position
 * and its draft stay.
 */
export function TwoPane({ list, children }: { list: ReactNode; children: ReactNode }) {
  const { isWide, listWidth } = usePaneLayout();
  return (
    <View className="bg-background flex-1 flex-row">
      {isWide ? (
        <>
          <View style={{ width: listWidth }}>{list}</View>
          <Separator orientation="vertical" />
        </>
      ) : null}
      <View className="flex-1">{children}</View>
    </View>
  );
}

/** The right pane with nothing selected yet. */
export function PanePlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View className="bg-surface-secondary flex-1 items-center justify-center">
      <EmptyState title={title} pose="thinking">
        {children}
      </EmptyState>
    </View>
  );
}
