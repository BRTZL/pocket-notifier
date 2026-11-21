import type { Session } from "@notifier/auth";
import type { Database } from "@notifier/db";

import type { Dispatch } from "./dispatch";
import type { Files } from "./lib/files";

export type Context = {
  session: Session | null;
  db: Database;
  /** Origin of the web app, without a trailing slash; invite links point here. */
  appUrl: string;
  dispatch: Dispatch;
  /** R2 storage for icons and attachments, and the origin their URLs are built on. */
  files: Files;
};
