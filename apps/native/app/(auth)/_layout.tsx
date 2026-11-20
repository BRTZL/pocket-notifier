import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

export const unstable_settings = {
  anchor: "sign-in",
};

export default function AuthLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
      <Stack.Screen name="invite/index" options={{ title: "Invite", headerShown: false }} />
      <Stack.Screen name="invite/[code]" options={{ title: "Join notifier", headerShown: false }} />
    </Stack>
  );
}
