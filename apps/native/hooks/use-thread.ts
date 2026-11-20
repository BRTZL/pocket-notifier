import type { ConversationRef } from "@notifier/contract/conversation";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useInvalidateReadState } from "@/hooks/use-conversations";
import { isAccessError } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 40;

/** One conversation's messages, newest first, older pages loaded on demand. */
export function useThread(conversation: ConversationRef) {
  const query = useInfiniteQuery({
    ...orpc.messages.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, limit: PAGE_SIZE, conversation }),
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
    // Retrying "not found" or "forbidden" only delays the not-available state.
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 3,
  });
  const messages = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { query, messages };
}

/**
 * Marks the whole conversation read once its messages show something unread, then
 * refetches the lists so the inbox count clears. A failure is silent: opening the
 * conversation again retries.
 */
export function useMarkConversationRead(conversation: ConversationRef, hasUnread: boolean) {
  const invalidate = useInvalidateReadState();
  const { mutate } = useMutation(
    orpc.messages.markRead.mutationOptions({ onSuccess: () => invalidate() }),
  );
  const isMarked = useRef(false);
  const { topicId, key } = conversation;
  useEffect(() => {
    if (!hasUnread || isMarked.current) {
      return;
    }
    isMarked.current = true;
    mutate(
      { conversation: { topicId, key } },
      {
        onError: () => {
          isMarked.current = false;
        },
      },
    );
  }, [hasUnread, mutate, topicId, key]);
}
