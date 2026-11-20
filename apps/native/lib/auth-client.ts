import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { ENV } from "../src/env";

export const authClient = createAuthClient({
  // The server's better-auth routes are at `<API base>/auth`. A baseURL with a path is
  // used as is, so this is the full auth base, not just the origin.
  baseURL: `${ENV.EXPO_PUBLIC_SERVER_URL}/auth`,
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
  ],
});

/**
 * The signed-in user's id right now, read outside React (e.g. in a toast callback that
 * may run after the screen or the session changed). `null` when signed out.
 */
export function currentUserId(): string | null {
  return authClient.$store.atoms.session?.get()?.data?.user.id ?? null;
}
