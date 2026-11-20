import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { HeroUINativeProvider, Spinner } from "heroui-native";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider } from "@/contexts/app-theme-provider";
import { useNavigationTheme } from "@/hooks/use-navigation-theme";
import { useAppStateFocus } from "@/hooks/use-refresh-on-focus";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

/**
 * Drops every cached query whenever the signed-in user changes (sign-in, sign-out,
 * switching accounts), so one account never sees another account's data.
 */
function useClearCacheOnUserChange(userId: string | null) {
  const previous = useRef<string | null>(userId);
  useEffect(() => {
    if (previous.current !== userId) {
      previous.current = userId;
      queryClient.clear();
    }
  }, [userId]);
}

function AuthGate() {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id ?? null;
  useClearCacheOnUserChange(userId);
  useAppStateFocus();

  if (isPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <Spinner size="lg" />
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
  return (
    <ThemeProvider value={navigationTheme}>
      <AuthGate />
    </ThemeProvider>
  );
}

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
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
