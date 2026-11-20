import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

export default function TopicsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Topics" }} />
      <Stack.Screen name="new" options={{ title: "New topic" }} />
      <Stack.Screen name="topic/[topicId]/index" options={{ title: "Topic" }} />
      <Stack.Screen name="topic/[topicId]/settings" options={{ title: "Topic settings" }} />
      <Stack.Screen name="topic/[topicId]/message/[id]" options={{ title: "Message" }} />
    </Stack>
  );
}
