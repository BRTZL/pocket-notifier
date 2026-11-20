import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * A query cache owned by one signed-in user. Mount it with `key={userId}`: a different
 * user remounts it with a fresh, empty `QueryClient`, and signing out unmounts it, so
 * cached rows can never render for another account. The oRPC client stays module-level;
 * only the cache is per user.
 */
export function UserQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
