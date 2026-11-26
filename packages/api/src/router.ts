import type { AppContract } from "@notifier/contract/app";
import type { Router, RouterClient } from "@orpc/server";

import type { Context } from "./context";
import { conversationsRouter } from "./procedures/conversations";
import { devicesRouter } from "./procedures/devices";
import { featuresRouter } from "./procedures/features";
import { invitesRouter } from "./procedures/invites";
import { meRouter } from "./procedures/me";
import { membersRouter } from "./procedures/members";
import { messagesRouter } from "./procedures/messages";
import { projectsRouter } from "./procedures/projects";
import { responsesRouter } from "./procedures/responses";
import { t3Router } from "./procedures/t3";
import { tokensRouter } from "./procedures/tokens";

/** Implements all of `appContract`; the `satisfies` check fails if a procedure is missing. */
export const appRouter = {
  me: meRouter,
  projects: projectsRouter,
  features: featuresRouter,
  members: membersRouter,
  conversations: conversationsRouter,
  t3: t3Router,
  messages: messagesRouter,
  responses: responsesRouter,
  tokens: tokensRouter,
  invites: invitesRouter,
  devices: devicesRouter,
} satisfies Router<AppContract, Context>;

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<AppRouter>;
