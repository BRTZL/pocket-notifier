import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

export default function InboxLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Inbox" }} />
      <Stack.Screen name="message/[id]" options={{ title: "Message" }} />
    </Stack>
  );
}
