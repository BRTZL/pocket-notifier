import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

export default function SettingsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}
