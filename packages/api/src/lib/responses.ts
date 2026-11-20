import { ResponseId } from "@notifier/contract/response";
import type { Database } from "@notifier/db";
import { user } from "@notifier/db/schema/auth";
import { messageResponse } from "@notifier/db/schema/notifier";
import { and, asc, eq, gt } from "drizzle-orm";

import { parseCursor, toPage } from "./messages";
import { toMessageResponse } from "./serialize";

/** A message's responses, oldest first. Access checks are the caller's job. */
export async function listResponses(
  db: Database,
  args: { messageId: string; cursor?: string; limit: number },
) {
  const cursor = parseCursor(ResponseId, args.cursor);
  const rows = await db
    .select({ response: messageResponse, user })
    .from(messageResponse)
    .innerJoin(user, eq(user.id, messageResponse.userId))
    .where(
      and(
        eq(messageResponse.messageId, args.messageId),
        cursor ? gt(messageResponse.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(messageResponse.id))
    .limit(args.limit + 1);
  return toPage(
    rows,
    args.limit,
    (row) => row.response.id,
    (row) => toMessageResponse(row.response, row.user),
  );
}
