import type { AppContract } from "@notifier/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";

import { ENV } from "../src/env";

/**
 * Cache for signed-out screens only (the invite preview). Signed-in screens get their
 * own client per user from `UserQueryProvider`, so no account ever reads another's cache.
 * Query errors are shown by the screens (inline error states and toasts), not logged.
 */
export const publicQueryClient = new QueryClient();

/** A request that hangs (e.g. opened while the server restarts) fails after this, so it can be retried. */
const REQUEST_TIMEOUT_MS = 20_000;

async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  request.signal.addEventListener("abort", abort);

  try {
    return await fetch(request.url, {
      body: await request.blob(),
      headers: request.headers,
      method: request.method,
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}

export const link = new RPCLink({
  url: `${ENV.EXPO_PUBLIC_SERVER_URL}/rpc`,
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    if (Platform.OS === "web") {
      return {};
    }
    const headers = new Map<string, string>();
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: ContractRouterClient<AppContract> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
