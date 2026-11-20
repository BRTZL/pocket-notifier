import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatAvatar } from "@/components/chat-avatar";
import { Icon, type IconName } from "@/components/icon";
import type { ChatAvatarSubject } from "@/lib/chat-avatar";

/** The large page title of a tab's first screen (`Inbox`, `Projects`, `Settings`). */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center justify-between pr-2 pl-5">
        <Typography
          accessibilityRole="header"
          className="font-heavy text-[30px] leading-[38px] tracking-[-0.9px]"
        >
          {title}
        </Typography>
        <View className="flex-row items-center">{right}</View>
      </View>
    </View>
  );
}

/** A 48pt round icon-only button for headers. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  size = 24,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
}) {
  return (
    <Button
      variant="ghost"
      isIconOnly
      className="size-12 rounded-full"
      onPress={onPress}
      accessibilityLabel={label}
    >
      <Icon name={icon} size={size} />
    </Button>
  );
}

function goBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

/**
 * The header of a pushed screen: back, an optional avatar, title and subtitle, and a
 * trailing slot. Drawn by the app instead of the native stack header, so it has the
 * design's 64pt bar and type.
 */
export function StackHeader({
  title,
  subtitle,
  avatar,
  right,
  onBack = goBack,
}: {
  title: string;
  subtitle?: string | null;
  avatar?: ChatAvatarSubject | null;
  right?: ReactNode;
  /** Defaults to going back in the stack (or home when there is nothing to go back to). */
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background border-border border-b" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center gap-2 px-1">
        <HeaderIconButton icon="arrow-back" label="Back" onPress={onBack} />
        {avatar ? <ChatAvatar subject={avatar} size={40} /> : null}
        <View className="ml-1 min-w-0 flex-1">
          <Typography
            numberOfLines={1}
            accessibilityRole="header"
            className="font-heavy text-[17px] leading-[22px]"
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography numberOfLines={1} className="text-muted text-[13px] leading-[17px]">
              {subtitle}
            </Typography>
          ) : null}
        </View>
        <View className="flex-row items-center">{right}</View>
      </View>
    </View>
  );
}
