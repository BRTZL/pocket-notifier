import "@/global.css";
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/figtree";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { HeroUINativeProvider, useThemeColor } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useUniwind } from "uniwind";

import { LoadingState } from "@/components/query-state";
import { AppThemeProvider } from "@/contexts/app-theme-provider";
import { useNavigationTheme } from "@/hooks/use-navigation-theme";
import { useAppStateFocus } from "@/hooks/use-refresh-on-focus";
import { authClient } from "@/lib/auth-client";
import { publicQueryClient } from "@/utils/orpc";

function AuthGate() {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id ?? null;
  useAppStateFocus();

  if (isPending) {
    return (
      <View className="bg-background flex-1">
        <LoadingState />
      </View>
    );
  }

  const isSignedIn = userId !== null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

function ThemedApp() {
  const navigationTheme = useNavigationTheme();
  const { theme } = useUniwind();
  const background = useThemeColor("background");
  // The window behind the status bar and its icons follow the theme, so a dark theme has
  // no white strip.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(background);
    StatusBar.setStyle(theme === "dark" ? "light" : "dark");
  }, [background, theme]);
  return (
    <ThemeProvider value={navigationTheme}>
      <AuthGate />
    </ThemeProvider>
  );
}

export default function Layout() {
  // Figtree is the app's only typeface (see global.css). Until it is loaded nothing
  // renders, so no text flashes in the system font; a load error falls back to it.
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });
  if (!(fontsLoaded || fontError)) {
    return null;
  }

  return (
    <QueryClientProvider client={publicQueryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <ThemedApp />
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
