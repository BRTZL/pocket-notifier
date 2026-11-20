import { router } from "expo-router";

import { SettingsList } from "@/components/settings-list";
import { PanePlaceholder } from "@/components/two-pane";
import { usePaneLayout } from "@/hooks/use-pane-layout";

/** The settings list; on a wide window the list lives in the layout's left pane instead. */
export default function SettingsScreen() {
  const { isWide } = usePaneLayout();
  if (isWide) {
    return (
      <PanePlaceholder title="Settings">Tokens, invites and devices open here.</PanePlaceholder>
    );
  }
  return <SettingsList onOpen={(href) => router.push(href)} />;
}
