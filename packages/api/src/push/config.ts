import { createFcmSender, type PushSender } from "./fcm";
import { parseServiceAccount } from "./service-account";

export type PushSetup =
  | { sender: PushSender; disabledReason?: undefined }
  | { sender: null; disabledReason: "missing FCM_SERVICE_ACCOUNT" | "invalid FCM_SERVICE_ACCOUNT" };

let memo: { raw: string | undefined; setup: PushSetup } | undefined;

/**
 * The FCM sender for the `FCM_SERVICE_ACCOUNT` secret, or why push is disabled. Parsed
 * once per isolate and reused while the secret stays the same.
 */
export function pushSetupFromSecret(raw: string | undefined): PushSetup {
  if (memo && memo.raw === raw) {
    return memo.setup;
  }
  const parsed = parseServiceAccount(raw);
  let setup: PushSetup;
  if (parsed.ok) {
    setup = { sender: createFcmSender(parsed.account) };
  } else {
    setup = {
      sender: null,
      disabledReason:
        parsed.reason === "missing" ? "missing FCM_SERVICE_ACCOUNT" : "invalid FCM_SERVICE_ACCOUNT",
    };
  }
  memo = { raw, setup };
  return setup;
}
