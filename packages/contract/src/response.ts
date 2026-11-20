import { z } from "zod";

import { idSchema, Timestamp, UserSummary } from "./common";
import { MessageId } from "./message";

export const ResponseId = idSchema("response");

export const RESPONSE_TEXT_MAX = 500;

/**
 * What a subscriber sent back through a `reply` action:
 * `ack` for a one-tap acknowledgement, `text` for an inline reply.
 */
export const MessageResponse = z.object({
  id: ResponseId,
  messageId: MessageId,
  actionKey: z.string(),
  kind: z.enum(["ack", "text"]),
  text: z.string().max(RESPONSE_TEXT_MAX).nullable(),
  user: UserSummary,
  createdAt: Timestamp,
});
export type MessageResponse = z.infer<typeof MessageResponse>;

export const CreateResponseInput = z.object({
  messageId: MessageId,
  actionKey: z.string().min(1).max(16),
  text: z.string().min(1).max(RESPONSE_TEXT_MAX).optional(),
});
