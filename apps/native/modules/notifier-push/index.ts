import { type EventSubscription, NativeModule, requireOptionalNativeModule } from "expo";

/**
 * notifier's Android push receiver (Kotlin, in `android/`). FCM data messages are turned
 * into notifications natively, so no JavaScript runs per push. This wrapper is for the
 * app's side: the FCM token, the session the notification buttons reply with, channels
 * and the notification permission.
 *
 * The native module only exists in a development or release build. In Expo Go (and on
 * iOS and web) `isPushAvailable` is `false` and every call is a no-op.
 *
 * Known gaps in v1:
 * - The push has no project id, so tapping opens the message's `clickUrl` when it is an
 *   http(s) or notifier link, else the inbox, never the conversation screen.
 * - A `truncated` push is shown as it arrived; the full message is not fetched.
 * - Avatars are always generated; `conversationIcon` and `senderIcon` URLs are not loaded.
 */

type NotifierPushEvents = {
  onToken: (event: { token: string }) => void;
};

declare class NotifierPushNative extends NativeModule<NotifierPushEvents> {
  getToken(): Promise<string | null>;
  setSession(serverUrl: string, cookie: string): Promise<void>;
  clearSession(): Promise<void>;
  ensureChannels(): Promise<void>;
  hasPermission(): boolean;
  requestPermission(): Promise<boolean>;
}

const native = requireOptionalNativeModule<NotifierPushNative>("NotifierPush");

export const isPushAvailable = native !== null;

/** The device's raw FCM registration token, or `null` without the module or Play services. */
export async function getToken(): Promise<string | null> {
  return native ? await native.getToken() : null;
}

/** Called with the new token whenever FCM rotates it while the app runs. */
export function addTokenListener(listener: (token: string) => void): EventSubscription {
  if (!native) {
    return { remove: () => undefined };
  }
  return native.addListener("onToken", (event) => listener(event.token));
}

/** Stores the server and session cookie (encrypted) so replies work while the app is closed. */
export async function setSession(session: { serverUrl: string; cookie: string }): Promise<void> {
  await native?.setSession(session.serverUrl, session.cookie);
}

export async function clearSession(): Promise<void> {
  await native?.clearSession();
}

/** Creates the five priority channels; safe to call on every start. */
export async function ensureChannels(): Promise<void> {
  await native?.ensureChannels();
}

/** Whether notifications are allowed for the app right now. */
export function hasPermission(): boolean {
  return native?.hasPermission() ?? false;
}

/** Asks for `POST_NOTIFICATIONS` on Android 13 and later; resolves with the result. */
export async function requestPermission(): Promise<boolean> {
  return native ? await native.requestPermission() : false;
}
