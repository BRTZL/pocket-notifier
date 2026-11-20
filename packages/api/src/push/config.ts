import { createFcmSender, type FcmDeps, type PushSender } from "./fcm";
import { prepareCredential } from "./oauth";
import { parseServiceAccount } from "./service-account";

export type PushSetup =
  | { sender: PushSender; disabledReason?: undefined }
  | { sender: null; disabledReason: "missing FCM_SERVICE_ACCOUNT" | "invalid FCM_SERVICE_ACCOUNT" };

let memo: { raw: string | undefined; setup: Promise<PushSetup> } | undefined;

async function buildSetup(
  raw: string | undefined,
  deps: Partial<FcmDeps>,
  warn: (message: string) => void,
): Promise<PushSetup> {
  const parsed = parseServiceAccount(raw);
  if (!parsed.ok && parsed.reason === "missing") {
    return { sender: null, disabledReason: "missing FCM_SERVICE_ACCOUNT" };
  }
  const credential = parsed.ok ? await prepareCredential(parsed.account) : null;
  if (!credential) {
    // Once per secret value: the setup is memoized, so this does not repeat per request.
    warn("push disabled: FCM_SERVICE_ACCOUNT is not a usable service-account key");
    return { sender: null, disabledReason: "invalid FCM_SERVICE_ACCOUNT" };
  }
  return { sender: createFcmSender(credential, deps) };
}

/**
 * The FCM sender for the `FCM_SERVICE_ACCOUNT` secret, or why push is disabled. The
 * secret is parsed and its private key imported once per secret value; a key that does
 * not import disables push.
 */
export function pushSetupFromSecret(
  raw: string | undefined,
  options: { deps?: Partial<FcmDeps>; warn?: (message: string) => void } = {},
): Promise<PushSetup> {
  if (memo && memo.raw === raw) {
    return memo.setup;
  }
  const setup = buildSetup(raw, options.deps ?? {}, options.warn ?? console.warn);
  memo = { raw, setup };
  return setup;
}

/** Forgets the memoized setup. For tests. */
export function resetPushSetup() {
  memo = undefined;
}
