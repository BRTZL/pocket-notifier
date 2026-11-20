import { NativeTabs } from "expo-router/native-tabs";
import { useThemeColor } from "heroui-native";

import { UserQueryProvider } from "@/components/user-query-provider";
import { authClient } from "@/lib/auth-client";

function Tabs() {
  const [background, accent, muted, accentSoft] = useThemeColor([
    "background",
    "accent",
    "muted",
    "accent-soft",
  ]);

  return (
    <NativeTabs
      backgroundColor={background}
      tintColor={accent}
      iconColor={{ default: muted, selected: accent }}
      indicatorColor={accentSoft}
      labelStyle={{ default: { color: muted }, selected: { color: accent } }}
    >
      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon sf="tray.fill" md="inbox" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(topics)">
        <NativeTabs.Trigger.Icon sf="number" md="tag" />
        <NativeTabs.Trigger.Label>Topics</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

export default function TabsLayout() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  // Signed out: the root guard is about to swap to the auth screens. Render nothing so no
  // query runs without a session.
  if (!userId) {
    return null;
  }
  return (
    <UserQueryProvider key={userId}>
      <Tabs />
    </UserQueryProvider>
  );
}
