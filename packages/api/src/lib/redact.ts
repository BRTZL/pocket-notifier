/**
 * Masks text that looks like a secret before it reaches a phone: agent replies and T3
 * errors can quote tokens, keys or connection strings. A safety net, not a guarantee;
 * senders should never include secrets in the first place.
 */

const MASK = "[redacted]";

/** Each pattern with its replacement; `$1` keeps a matched prefix such as `TOKEN=`. */
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // PEM private keys, whole block or a cut-off start.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu, MASK],
  // Well-known token prefixes: GitHub, Slack, OpenAI/Anthropic, Stripe, AWS, Google,
  // npm, this server's access tokens.
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|nt_[A-Za-z0-9_-]{20,})\b/gu,
    MASK,
  ],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, MASK],
  // Credentials inside URLs: scheme://user:password@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/giu, `$1${MASK}@`],
  // Bearer tokens in headers.
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gu, `$1${MASK}`],
  // key=value or key: value where the key names a secret.
  [
    /\b((?:[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*)\s*[=:]\s*)["']?[^\s"']{6,}["']?/giu,
    `$1${MASK}`,
  ],
];

/** `text` with anything that looks like a secret replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
