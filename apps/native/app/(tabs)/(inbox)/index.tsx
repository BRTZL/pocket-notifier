import { router } from "expo-router";

import { InboxList } from "@/components/inbox-list";
import { PanePlaceholder } from "@/components/two-pane";
import { usePaneLayout } from "@/hooks/use-pane-layout";

/** The inbox list; on a wide window the list lives in the layout's left pane instead. */
export default function InboxScreen() {
  const { isWide } = usePaneLayout();
  if (isWide) {
    return <PanePlaceholder title="Select a conversation">Its thread opens here.</PanePlaceholder>;
  }
  return (
    <InboxList
      onSelect={(conversation) =>
        router.push({
          pathname: "/conversation/[projectId]/[key]",
          params: {
            projectId: conversation.projectId,
            key: conversation.key,
            title: conversation.title,
          },
        })
      }
    />
  );
}
