import { z } from "zod";

/** The fields of a Firebase service-account key file that the FCM sender needs. */
export const ServiceAccount = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().includes("PRIVATE KEY"),
});
export type ServiceAccount = z.infer<typeof ServiceAccount>;

export type ServiceAccountResult =
  | { ok: true; account: ServiceAccount }
  | { ok: false; reason: "missing" | "invalid" };

const RAW_NEWLINES = /\r?\n/gu;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // A double-quoted `.env` value may have had the `\n`s in `private_key` expanded into
    // real newlines, which JSON does not allow inside strings. Escape them back.
    try {
      return JSON.parse(raw.replace(RAW_NEWLINES, "\\n"));
    } catch {
      return null;
    }
  }
}

/**
 * Parses `FCM_SERVICE_ACCOUNT`: the service-account JSON as one string. An unset or
 * blank value is `missing`; anything that is not a usable key file is `invalid`.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccountResult {
  if (raw === undefined || raw.trim() === "") {
    return { ok: false, reason: "missing" };
  }
  const parsed = ServiceAccount.safeParse(parseJson(raw));
  return parsed.success ? { ok: true, account: parsed.data } : { ok: false, reason: "invalid" };
}
