import type { AppContract } from "@notifier/contract/app";
import type { Router, RouterClient } from "@orpc/server";

import type { Context } from "./context";
import { meRouter } from "./procedures/me";
import { membersRouter } from "./procedures/members";
import { tokensRouter } from "./procedures/tokens";
import { topicsRouter } from "./procedures/topics";

type ImplementedNamespaces = "me" | "topics" | "members" | "tokens";

/**
 * The implemented part of `appContract`. The remaining namespaces (messages, responses,
 * invites, devices) are added by later tasks; until then the RPC handler answers
 * their paths with its unmatched-route 404.
 */
export const appRouter = {
  me: meRouter,
  topics: topicsRouter,
  members: membersRouter,
  tokens: tokensRouter,
} satisfies Router<Pick<AppContract, ImplementedNamespaces>, Context>;

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<AppRouter>;
