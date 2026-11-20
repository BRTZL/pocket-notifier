// biome-ignore lint/security/noSecrets: the base62 alphabet, not a secret.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Largest multiple of 62 that fits in a byte; bytes at or above it are discarded. */
const UNBIASED_LIMIT = 248;
/** `getRandomValues` refuses more than 65,536 bytes per call. */
const MAX_RANDOM_BYTES = 65_536;

/** SHA-256 of the UTF-8 text as 64 lowercase hex characters. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Random string of `length` base62 characters from `crypto.getRandomValues`. Uses
 * rejection sampling (bytes >= 248 are dropped) so every character is equally likely.
 */
export function randomBase62(length: number): string {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError("length must be a non-negative integer");
  }
  let out = "";
  while (out.length < length) {
    // Ask for a little more than needed: about 3% of bytes are rejected.
    const wanted = Math.ceil((length - out.length) * 1.1) + 4;
    const bytes = crypto.getRandomValues(new Uint8Array(Math.min(wanted, MAX_RANDOM_BYTES)));
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT) {
        out += BASE62.charAt(byte % 62);
        if (out.length === length) {
          break;
        }
      }
    }
  }
  return out;
}
