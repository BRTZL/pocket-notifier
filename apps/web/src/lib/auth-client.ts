import { createAuthClient } from "better-auth/react";

import { SERVER_URL } from "@/lib/public-env";

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
});
