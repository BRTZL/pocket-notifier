import { InviteCode } from "@notifier/contract/invite";

/** The last non-empty path segment of a link, ignoring its query and fragment. */
function lastPathSegment(link: URL): string {
  const segments = link.pathname.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) ?? "");
}

/**
 * The invite code from what a person pasted: a whole invite link (web or
 * `notifier://invite/<code>`) or the bare code. `null` when it is not a valid code.
 */
export function inviteCodeFromInput(input: string): string | null {
  const trimmed = input.trim();
  let candidate = trimmed;
  try {
    const link = new URL(trimmed);
    // `notifier://invite/<code>` puts "invite" in the host, so the path is just the code.
    candidate = lastPathSegment(link);
  } catch {
    // Not a URL: treat it as the bare code.
  }
  return parseInviteCode(candidate);
}

/** The code if it has the contract's invite-code shape, else `null`. */
export function parseInviteCode(code: string): string | null {
  const parsed = InviteCode.safeParse(code);
  return parsed.success ? parsed.data : null;
}
