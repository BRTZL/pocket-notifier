import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import { Button, Spinner, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { AppearancePicker } from "@/components/appearance-picker";
import type { IconName } from "@/components/icon";
import { ScreenHeader } from "@/components/screen-header";
import { SectionHeader, SettingsRow } from "@/components/settings-row";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";

import { ENV } from "@/src/env";

const LINKS: { title: string; description: string; href: Href; icon: IconName }[] = [
  {
    title: "Access tokens",
    description: "Let scripts and agents publish",
    href: "/tokens",
    icon: "key",
  },
  {
    title: "Invites",
    description: "Bring people onto this server",
    href: "/invites",
    icon: "person-add",
  },
  {
    title: "Devices",
    description: "Phones that get your pushes",
    href: "/devices",
    icon: "smartphone",
  },
];

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const user = session?.user;

  async function signOut() {
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not sign out") });
      }
      // Signing out unmounts the tabs and with them this user's query cache.
    } catch (error) {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not sign out") });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Settings" />
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        {user ? (
          <View className="flex-row items-center gap-3.5 px-5 py-3">
            <UserAvatar
              user={{ id: user.id, name: user.name, email: user.email, image: user.image ?? null }}
              size="lg"
            />
            <View className="min-w-0 flex-1">
              <Typography numberOfLines={1} className="font-heavy text-[17px] leading-[22px]">
                {user.name}
              </Typography>
              <Typography numberOfLines={1} className="text-muted text-[15px] leading-[21px]">
                {user.email}
              </Typography>
            </View>
          </View>
        ) : null}

        <SectionHeader title="Publishing and people" />
        {LINKS.map((link) => (
          <SettingsRow
            key={link.title}
            icon={link.icon}
            title={link.title}
            description={link.description}
            onPress={() => router.push(link.href)}
          />
        ))}

        <SectionHeader title="Appearance" />
        <AppearancePicker />

        <SectionHeader title="About" />
        <SettingsRow
          icon="info"
          title="App version"
          trailing={
            <Typography className="text-muted text-[15px]">
              {Constants.expoConfig?.version ?? "unknown"}
            </Typography>
          }
        />
        <SettingsRow icon="dns" title="Server" description={ENV.EXPO_PUBLIC_SERVER_URL} />

        <View className="px-5 pt-6">
          <Button
            variant="danger-soft"
            className="h-[52px] rounded-full"
            onPress={() => void signOut()}
            isDisabled={isSigningOut}
          >
            {isSigningOut ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label className="font-bold">Sign out</Button.Label>
            )}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
