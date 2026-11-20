import { ID_PREFIXES, type IdKind } from "@notifier/contract/common";

/** Crockford base32 in lowercase: no i, l, o or u. */
// biome-ignore lint/security/noSecrets: the base32 alphabet, not a secret.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(ms: number): string {
  let rest = ms;
  let out = "";
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    out = `${ALPHABET.charAt(rest % 32)}${out}`;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(): string {
  // 256 is a multiple of 32, so `byte % 32` is uniform: 16 chars carry 80 random bits.
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % 32);
  }
  return out;
}

/**
 * Creates a notifier ID: `<prefix>_<26 lowercase Crockford base32 chars>`.
 * The chars are a ULID (48-bit ms timestamp, then 80 random bits), so IDs sort by
 * creation time and work as pagination cursors.
 */
export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${encodeTime(Date.now())}${encodeRandom()}`;
}
