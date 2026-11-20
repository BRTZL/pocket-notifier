import { DarkTheme, DefaultTheme, type Theme } from "expo-router/react-navigation";
import { useThemeColor } from "heroui-native";
import { useUniwind } from "uniwind";

/** A React Navigation theme built from the HeroUI theme, so native headers and screens match it. */
export function useNavigationTheme(): Theme {
  const { theme } = useUniwind();
  const [background, foreground, accent, border, danger] = useThemeColor([
    "background",
    "foreground",
    "accent",
    "border",
    "danger",
  ]);
  const base = theme === "dark" ? DarkTheme : DefaultTheme;

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: accent,
      background,
      card: background,
      text: foreground,
      border,
      notification: danger,
    },
    dark: theme === "dark",
  };
}

/** Header options shared by every tab's stack. */
export function useStackScreenOptions() {
  const [background, foreground] = useThemeColor(["background", "foreground"]);
  return {
    headerStyle: { backgroundColor: background },
    headerTintColor: foreground,
    headerTitleStyle: { color: foreground },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: background },
  };
}
