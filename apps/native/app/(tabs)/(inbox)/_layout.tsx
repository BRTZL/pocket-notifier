import { Stack } from "expo-router";

import { InboxList } from "@/components/inbox-list";
import { TwoPane } from "@/components/two-pane";
import { useStackScreenOptions } from "@/hooks/use-navigation-theme";
import { usePaneLayout } from "@/hooks/use-pane-layout";
import { openInPane, usePaneRoute } from "@/hooks/use-pane-route";

/** The inbox is the conversation list; a conversation opens as a thread with its own header. */
export const unstable_settings = {
  anchor: "index",
};

/** Wide window: the conversation list, its open thread highlighted. */
function InboxPane() {
  const route = usePaneRoute("(inbox)");
  const { projectId, key } = route?.params ?? {};
  const selected =
    route?.path[0] === "conversation" && projectId && key ? { projectId, key } : null;
  return (
    <InboxList
      selected={selected}
      onSelect={(conversation) => {
        if (selected?.projectId === conversation.projectId && selected.key === conversation.key) {
          return;
        }
        openInPane(
          {
            pathname: "/conversation/[projectId]/[key]",
            params: {
              projectId: conversation.projectId,
              key: conversation.key,
              title: conversation.title,
            },
          },
          { isDetailOpen: selected !== null },
        );
      }}
    />
  );
}

export default function InboxLayout() {
  const screenOptions = useStackScreenOptions();
  const { isWide } = usePaneLayout();
  return (
    <TwoPane list={<InboxPane />}>
      {/* The right pane swaps threads in place, like a mail app: no slide. */}
      <Stack screenOptions={{ ...screenOptions, animation: isWide ? "none" : "default" }}>
        <Stack.Screen name="index" options={{ title: "Inbox", headerShown: false }} />
        <Stack.Screen
          name="conversation/[projectId]/[key]"
          options={{ title: "Conversation", headerShown: false }}
        />
      </Stack>
    </TwoPane>
  );
}
