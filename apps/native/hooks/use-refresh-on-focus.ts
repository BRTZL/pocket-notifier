import { focusManager } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

/** Tells TanStack Query when the app comes to the foreground, so stale queries refetch. */
export function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);
}

/** Refetches when the screen regains focus (e.g. coming back from a tab or a pushed screen). */
export function useRefreshOnFocus(refetch: () => Promise<unknown>) {
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}
