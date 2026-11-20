import { Stack } from "expo-router";

import { SettingsList } from "@/components/settings-list";
import { TwoPane } from "@/components/two-pane";
import { useStackScreenOptions } from "@/hooks/use-navigation-theme";
import { usePaneLayout } from "@/hooks/use-pane-layout";
import { openInPane, usePaneRoute } from "@/hooks/use-pane-route";

/** Wide window: the settings list, its open sub-screen highlighted. */
function SettingsPane() {
  const route = usePaneRoute("(settings)");
  const selected = route?.path[0] ?? null;
  return (
    <SettingsList
      selected={selected}
      onOpen={(href, section) => {
        if (section !== selected) {
          openInPane(href, { isDetailOpen: selected !== null });
        }
      }}
    />
  );
}

export default function SettingsLayout() {
  const screenOptions = useStackScreenOptions();
  const { isWide } = usePaneLayout();
  return (
    <TwoPane list={<SettingsPane />}>
      <Stack screenOptions={{ ...screenOptions, animation: isWide ? "none" : "default" }}>
        <Stack.Screen name="index" options={{ title: "Settings", headerShown: false }} />
        <Stack.Screen name="tokens/index" options={{ title: "Access tokens" }} />
        <Stack.Screen name="tokens/new" options={{ title: "New token" }} />
        <Stack.Screen name="invites/index" options={{ title: "Invites" }} />
        <Stack.Screen name="invites/new" options={{ title: "New invite" }} />
        <Stack.Screen name="devices" options={{ title: "Devices" }} />
      </Stack>
    </TwoPane>
  );
}
