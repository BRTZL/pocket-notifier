import type { ConversationRef } from "@notifier/contract/conversation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

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
 * The conversation's inbox row: its title, avatar, last sender and the open ask the
 * composer answers. Its success also confirms the caller still has access.
 */
export function useConversationSummary(conversation: ConversationRef) {
  return useQuery({
    ...orpc.conversations.get.queryOptions({ input: { conversation } }),
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 3,
  });
}

/** Per conversation, so a mark already in flight is found and not sent twice. */
function markReadKey({ topicId, key }: ConversationRef) {
  return [...orpc.messages.markRead.mutationKey(), "conversation", topicId, key];
}

/**
 * Marks the whole conversation read once per focused open, as soon as `canMark` says
 * access is confirmed, whatever the loaded rows show (older pages may hold unread
 * messages, and new ones may have arrived). A mark already in flight for the same
 * conversation is not repeated. Success refetches the lists so the inbox count clears;
 * a failure is silent, and the next open retries.
 */
export function useMarkConversationRead(conversation: ConversationRef, canMark: boolean) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReadState();
  const { topicId, key } = conversation;
  const mutationKey = markReadKey({ topicId, key });
  const { mutate } = useMutation({
    ...orpc.messages.markRead.mutationOptions({ onSuccess: () => invalidate() }),
    mutationKey,
  });
  const [isFocused, setIsFocused] = useState(false);
  const isMarkedThisFocus = useRef(false);

  useFocusEffect(
    useCallback(() => {
      isMarkedThisFocus.current = false;
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    if (!(canMark && isFocused) || isMarkedThisFocus.current) {
      return;
    }
    isMarkedThisFocus.current = true;
    if (queryClient.isMutating({ mutationKey }) > 0) {
      return;
    }
    mutate({ conversation: { topicId, key } });
  }, [canMark, isFocused, mutate, queryClient, mutationKey, topicId, key]);
}
