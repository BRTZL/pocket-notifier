import { PressableFeedback, Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { Icon, type IconName } from "@/components/icon";

/** A small uppercase-free section title above a group of rows. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <Typography
      accessibilityRole="header"
      className="text-muted px-5 pt-5 pb-1.5 text-[13px] leading-[18px] font-bold"
    >
      {title}
    </Typography>
  );
}

/**
 * One settings or topic row in the inbox row style: a glyph on a quiet circle, a title,
 * an optional description, and a trailing slot (a chevron when it navigates).
 */
export function SettingsRow({
  icon,
  title,
  description,
  trailing,
  onPress,
  accessibilityLabel,
}: {
  icon?: IconName;
  title: string;
  description?: string | null;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      {icon ? (
        <View className="bg-surface size-10 items-center justify-center rounded-full">
          <Icon name={icon} size={21} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <Typography numberOfLines={1} className="text-[17px] leading-[22px] font-semibold">
          {title}
        </Typography>
        {description ? (
          <Typography numberOfLines={2} className="text-muted text-[14px] leading-[19px]">
            {description}
          </Typography>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-right" color="muted" /> : null)}
    </>
  );
  if (!onPress) {
    return (
      <View
        className="min-h-[60px] flex-row items-center gap-3.5 px-5 py-2.5"
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      className="min-h-[60px] flex-row items-center gap-3.5 px-5 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      <PressableFeedback.Highlight />
      {content}
    </PressableFeedback>
  );
}
