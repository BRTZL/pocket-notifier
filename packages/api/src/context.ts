import type { Session } from "@notifier/auth";
import type { Database } from "@notifier/db";

import type { Dispatch } from "./dispatch";

export type Context = {
  session: Session | null;
  db: Database;
  /** Origin of the web app, without a trailing slash; invite links point here. */
  appUrl: string;
  dispatch: Dispatch;
};
