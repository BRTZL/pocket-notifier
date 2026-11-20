import type { InboxMessage, MyResponse } from "@notifier/contract/message";
import type { MessageResponse } from "@notifier/contract/response";
import { type InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "heroui-native";
import { useState } from "react";

import { errorMessage, hasErrorCode } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The caller's response to one of the message's actions, if they already answered it. */
export function responseTo(message: InboxMessage, actionKey: string): MyResponse | undefined {
  return message.myResponses.find((response) => response.actionKey === actionKey);
}

/**
 * Answers in flight, by `messageId:actionKey`. Shared by every sender (quick replies,
 * the composer, the detail screen) and checked synchronously, so two taps on the same
 * action, or a pill and the composer at once, never send it twice.
 */
const inFlight = new Set<string>();

/** How sending an answer ended. */
export type SendResult = "sent" | "already-answered" | "failed";

type InboxPage = { items: InboxMessage[]; nextCursor: string | null };

function withResponse(message: InboxMessage, response: MessageResponse): InboxMessage {
  if (message.id !== response.messageId || responseTo(message, response.actionKey)) {
    return message;
  }
  const mine: MyResponse = {
    actionKey: response.actionKey,
    kind: response.kind,
    text: response.text,
    createdAt: response.createdAt,
  };
  return { ...message, myResponses: [...message.myResponses, mine] };
}

/**
 * Sends a `reply` action's response, at most once at a time per action.
 *
 * - Sent: the cached message gets the response right away (no wait for a refetch), and
 *   the conversation's open ask refetches.
 * - CONFLICT: it was answered before, e.g. on another device. A toast says so, the
 *   caller keeps its draft, and the lists refetch to show the earlier answer.
 * - Any other failure: a toast, and the draft stays.
 */
export function useSendResponse() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation(orpc.responses.create.mutationOptions());
  const [pending, setPending] = useState(0);

  function applyToCache(response: MessageResponse) {
    queryClient.setQueriesData<InfiniteData<InboxPage>>(
      { queryKey: orpc.messages.list.key() },
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => withResponse(item, response)),
          })),
        },
    );
    queryClient.setQueriesData<InboxMessage>({ queryKey: orpc.messages.get.key() }, (data) =>
      data ? withResponse(data, response) : data,
    );
  }

  async function refetchAfterAnswer() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.conversations.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.messages.key() }),
    ]);
  }

  async function send(input: {
    messageId: string;
    actionKey: string;
    text?: string;
  }): Promise<SendResult> {
    const lock = `${input.messageId}:${input.actionKey}`;
    if (inFlight.has(lock)) {
      return "failed";
    }
    inFlight.add(lock);
    setPending((count) => count + 1);
    try {
      const response = await mutation.mutateAsync(input);
      applyToCache(response);
      void refetchAfterAnswer();
      return "sent";
    } catch (error) {
      if (hasErrorCode(error, "CONFLICT")) {
        toast.show({ label: "Already answered", description: "This was answered before." });
        void refetchAfterAnswer();
        return "already-answered";
      }
      toast.show({ variant: "danger", label: errorMessage(error, "Could not send the reply") });
      return "failed";
    } finally {
      inFlight.delete(lock);
      setPending((count) => count - 1);
    }
  }

  return { send, isSending: pending > 0 };
}
