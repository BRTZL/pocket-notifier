import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

export default function SettingsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="tokens/index" options={{ title: "Access tokens" }} />
      <Stack.Screen name="tokens/new" options={{ title: "New token" }} />
      <Stack.Screen name="invites/index" options={{ title: "Invites" }} />
      <Stack.Screen name="invites/new" options={{ title: "New invite" }} />
      <Stack.Screen name="devices" options={{ title: "Devices" }} />
    </Stack>
  );
}
