import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { registerPushDevice, syncPushSession } from "@/lib/push-device";
import * as NotifierPush from "@/modules/notifier-push";

/** Set once the explanation was shown, so the app asks only once, as the docs promise. */
const ASKED_KEY = "notifier.push.permissionAsked";

/**
 * Push setup for the signed-in user: channels, the native session for notification
 * replies, device registration on every start and token rotation, and the one-time
 * permission ask. Does nothing where the native module is missing (Expo Go).
 */
export function usePushRegistration() {
  const [isAsking, setIsAsking] = useState(false);

  useEffect(() => {
    if (!NotifierPush.isPushAvailable) {
      return;
    }
    let isActive = true;
    const register = (token: string) => {
      registerPushDevice(token).catch(() => {
        // Retried on the next start or token rotation.
      });
    };

    async function setUp() {
      await NotifierPush.ensureChannels();
      await syncPushSession();
      const token = await NotifierPush.getToken();
      if (token && isActive) {
        register(token);
      }
      const asked = await SecureStore.getItemAsync(ASKED_KEY);
      if (isActive && !asked && !NotifierPush.hasPermission()) {
        setIsAsking(true);
      }
    }
    setUp().catch(() => {
      // Push is optional; the app works without it.
    });

    const tokenSubscription = NotifierPush.addTokenListener(register);
    // Better Auth may refresh the cookie; keep the native copy current.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncPushSession().catch(() => undefined);
      }
    });
    return () => {
      isActive = false;
      tokenSubscription.remove();
      appState.remove();
    };
  }, []);

  async function answer(allow: boolean) {
    setIsAsking(false);
    await SecureStore.setItemAsync(ASKED_KEY, "1");
    if (allow) {
      await NotifierPush.requestPermission();
    }
  }

  return { isAsking, answer };
}
