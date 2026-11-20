import { NativeTabs } from "expo-router/native-tabs";
import { useThemeColor } from "heroui-native";

export default function TabsLayout() {
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
