import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

/** The inbox is the conversation list; a conversation opens as a thread with its own header. */
export const unstable_settings = {
  anchor: "index",
};

export default function InboxLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Inbox", headerShown: false }} />
      <Stack.Screen
        name="conversation/[topicId]/[key]"
        options={{ title: "Conversation", headerShown: false }}
      />
    </Stack>
  );
}
