import type { AppContract } from "@notifier/contract/app";
import type { Router, RouterClient } from "@orpc/server";

import type { Context } from "./context";
import { conversationsRouter } from "./procedures/conversations";
import { devicesRouter } from "./procedures/devices";
import { invitesRouter } from "./procedures/invites";
import { meRouter } from "./procedures/me";
import { membersRouter } from "./procedures/members";
import { messagesRouter } from "./procedures/messages";
import { responsesRouter } from "./procedures/responses";
import { tokensRouter } from "./procedures/tokens";
import { topicsRouter } from "./procedures/topics";

/** Implements all of `appContract`; the `satisfies` check fails if a procedure is missing. */
export const appRouter = {
  me: meRouter,
  topics: topicsRouter,
  members: membersRouter,
  conversations: conversationsRouter,
  messages: messagesRouter,
  responses: responsesRouter,
  tokens: tokensRouter,
  invites: invitesRouter,
  devices: devicesRouter,
} satisfies Router<AppContract, Context>;

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<AppRouter>;
