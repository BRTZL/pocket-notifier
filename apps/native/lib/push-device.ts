import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import * as NotifierPush from "@/modules/notifier-push";
import { ENV } from "@/src/env";
import { client } from "@/utils/orpc";

/** The id the server gave this phone, so signing out can remove it. */
const DEVICE_ID_KEY = "notifier.push.deviceId";
const NAME_MAX = 80;

function deviceName(): string {
  const constants = Platform.constants as { Model?: string; Manufacturer?: string };
  const name = constants.Model?.trim() || "Android phone";
  return name.slice(0, NAME_MAX);
}

/** Registers (upserts by token) this phone for pushes and remembers its device id. */
export async function registerPushDevice(pushToken: string): Promise<void> {
  const device = await client.devices.register({
    pushToken,
    name: deviceName(),
    platform: "android",
    appVersion: Constants.expoConfig?.version,
  });
  await SecureStore.setItemAsync(DEVICE_ID_KEY, device.id);
}

/** Copies the session cookie to the native side, for replies from the notification. */
export async function syncPushSession(): Promise<void> {
  const cookie = await authClient.getCookie();
  if (cookie) {
    await NotifierPush.setSession({ serverUrl: ENV.EXPO_PUBLIC_SERVER_URL, cookie });
  }
}

/**
 * Before signing out: removes this phone from the account, so it stops getting this
 * user's pushes, and forgets the native session. Best effort; a failed remove leaves the
 * device listed until the next user registers the same token or the 60-day cleanup.
 */
export async function unregisterPushDevice(): Promise<void> {
  if (!NotifierPush.isPushAvailable) {
    return;
  }
  try {
    const id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (id) {
      await client.devices.remove({ id });
    }
  } catch {
    // Signing out must not fail because the server is unreachable.
  }
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
  await NotifierPush.clearSession();
}
