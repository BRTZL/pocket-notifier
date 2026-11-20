import { GOOGLE_TOKEN_URL, prepareCredential } from "../src/push/oauth";
import type { ServiceAccount } from "../src/push/service-account";

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

const PEM_LINE = /.{1,64}/gu;

/**
 * A fresh RSA key pair, a service account whose `private_key` is its PKCS #8 PEM, and
 * the imported credential.
 */
export async function testServiceAccount(clientEmail = "push@test.iam.gserviceaccount.com") {
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = (await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer;
  const lines = toBase64(der).match(PEM_LINE) ?? [];
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  const account: ServiceAccount = {
    project_id: "notifier-test",
    client_email: clientEmail,
    private_key: pem,
  };
  const credential = await prepareCredential(account);
  if (!credential) {
    throw new Error("test key did not import");
  }
  return { account, credential, publicKey: keys.publicKey };
}

export type RecordedRequest = { url: string; init: RequestInit | undefined };

/**
 * A `fetch` that answers the OAuth token endpoint with `tokens` (one per exchange,
 * the last repeated) and FCM sends with `sends` in order (the last repeated).
 */
type Respond = () => Response | Promise<Response>;

export function mockFetch(options: { sends?: Respond[]; tokens?: Respond[] }) {
  const requests: RecordedRequest[] = [];
  let tokenCalls = 0;
  let sendCalls = 0;
  const sends = options.sends ?? [() => Response.json({ name: "projects/x/messages/1" })];
  const tokens = options.tokens ?? [
    () => Response.json({ access_token: `access-${tokenCalls}`, expires_in: 3600 }),
  ];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === GOOGLE_TOKEN_URL) {
      tokenCalls += 1;
      const respond = tokens[Math.min(tokenCalls - 1, tokens.length - 1)];
      if (!respond) {
        throw new Error("no token response");
      }
      return respond();
    }
    sendCalls += 1;
    const respond = sends[Math.min(sendCalls - 1, sends.length - 1)];
    if (!respond) {
      throw new Error("no send response");
    }
    return respond();
  };
  return {
    fetch: fetchMock as typeof fetch,
    requests,
    tokenRequests: () => requests.filter((request) => request.url === GOOGLE_TOKEN_URL),
    sendRequests: () => requests.filter((request) => request.url !== GOOGLE_TOKEN_URL),
  };
}

export function fcmError(
  httpStatus: number,
  error: { status: string; message?: string; details?: unknown[] },
  headers?: HeadersInit,
) {
  return () =>
    Response.json(
      { error: { code: httpStatus, message: error.message ?? "", ...error } },
      { status: httpStatus, headers },
    );
}

export const UNREGISTERED = fcmError(404, {
  status: "NOT_FOUND",
  message: "Requested entity was not found.",
  details: [
    { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" },
  ],
});
