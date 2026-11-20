import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";

import { type TokenColor, useTokenColors } from "@/hooks/use-token-color";

export type IconName = ComponentProps<typeof MaterialIcons>["name"];

/** A Material icon in a theme color. Decorative: the control around it carries the label. */
export function Icon({
  name,
  size = 24,
  color = "foreground-secondary",
}: {
  name: IconName;
  size?: number;
  color?: TokenColor;
}) {
  const [themeColor] = useTokenColors([color]);
  return (
    <MaterialIcons
      name={name}
      size={size}
      color={themeColor}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
