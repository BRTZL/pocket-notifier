// Next.js inlines `process.env.NEXT_PUBLIC_*` into client bundles only when the
// variable is accessed literally, so it cannot go through an env helper.
// biome-ignore lint/style/noProcessEnv: literal access is required for client inlining.
const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL;

if (!serverUrl) {
  throw new Error("NEXT_PUBLIC_SERVER_URL is not set");
}

const TRAILING_SLASH = /\/$/u;

export const SERVER_URL = serverUrl.replace(TRAILING_SLASH, "");
