import { useThemeColor } from "heroui-native";
import { RefreshControl, type RefreshControlProps } from "react-native";

type ThemedRefreshControlProps = Omit<
  RefreshControlProps,
  "colors" | "tintColor" | "progressBackgroundColor" | "titleColor"
>;

/**
 * Pull-to-refresh that follows the app theme: the spinner uses the accent color and,
 * on Android, sits on a disc in the theme's surface color instead of the platform's
 * fixed white, so it reads correctly in dark mode too.
 */
export function ThemedRefreshControl(props: ThemedRefreshControlProps) {
  const [accent, surface, muted] = useThemeColor(["accent", "surface", "muted"]);
  return (
    <RefreshControl
      {...props}
      colors={[accent]}
      tintColor={accent}
      titleColor={muted}
      progressBackgroundColor={surface}
    />
  );
}
