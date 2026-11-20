import { NativeTabs } from "expo-router/native-tabs";

import { PushRegistration } from "@/components/push-registration";
import { UserQueryProvider } from "@/components/user-query-provider";
import { useTokenColors } from "@/hooks/use-token-color";
import { authClient } from "@/lib/auth-client";

/** Tab label type: Figtree 700 at 12.5pt, as in the design. */
const LABEL_FONT = { fontFamily: "Figtree_700Bold", fontSize: 12.5 } as const;

function Tabs() {
  const [surface, foreground, muted, accentSoft, accentSoftForeground] = useTokenColors([
    "surface",
    "foreground",
    "muted",
    "accent-soft",
    "accent-soft-foreground",
  ] as const);

  return (
    <NativeTabs
      backgroundColor={surface}
      tintColor={accentSoftForeground}
      iconColor={{ default: muted, selected: accentSoftForeground }}
      indicatorColor={accentSoft}
      rippleColor={accentSoft}
      labelStyle={{
        default: { ...LABEL_FONT, color: muted },
        selected: { ...LABEL_FONT, color: foreground },
      }}
    >
      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" md="forum" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(projects)">
        <NativeTabs.Trigger.Icon sf="folder.fill" md="folder" />
        <NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
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
      <PushRegistration />
    </UserQueryProvider>
  );
}
