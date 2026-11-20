import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "heroui-native";

import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 30;

/** The conversation inbox, newest first, page by page with `nextCursor`. */
export function useConversations() {
  const query = useInfiniteQuery(
    orpc.conversations.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, limit: PAGE_SIZE }),
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  );
  const conversations = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { query, conversations };
}

/**
 * Refetches everything that shows read state or responses: conversations, message lists
 * and single messages, and project unread counts.
 */
export function useInvalidateReadState() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.conversations.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.messages.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
    ]);
  };
}

/** "Mark all read": everything up to the newest message the inbox shows. */
export function useMarkAllRead() {
  const invalidate = useInvalidateReadState();
  const { toast } = useToast();
  const mutation = useMutation(
    orpc.messages.markRead.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not mark as read") });
      },
    }),
  );
  return {
    markAllRead: (newestMessageId: string) => mutation.mutate({ upTo: newestMessageId }),
    isPending: mutation.isPending,
  };
}
