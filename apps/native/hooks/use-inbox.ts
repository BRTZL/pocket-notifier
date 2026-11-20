import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "heroui-native";
import { useEffect, useRef } from "react";

import { errorMessage } from "@/lib/errors";

import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 30;

/** The combined inbox, newest first, loaded page by page with `nextCursor`. */
export function useInbox({ unreadOnly }: { unreadOnly: boolean }) {
  const query = useInfiniteQuery(
    orpc.messages.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, limit: PAGE_SIZE, unreadOnly }),
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  );
  const messages = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { query, messages };
}

/** Refetches the inbox lists and topic unread counts after something was read or answered. */
export function useInvalidateInbox() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.messages.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.topics.key() }),
    ]);
  };
}

/**
 * One message; marks it read the first time it is shown unread. If marking fails, a
 * toast offers "Try again", and the next time the message is shown it tries again.
 */
export function useMessage(id: string) {
  const query = useQuery(orpc.messages.get.queryOptions({ input: { id } }));
  const invalidateInbox = useInvalidateInbox();
  const { toast } = useToast();
  const { mutate } = useMutation(
    orpc.messages.markRead.mutationOptions({
      onSuccess: async () => {
        await invalidateInbox();
      },
    }),
  );
  const markedId = useRef<string | null>(null);
  const isUnread = query.data?.read === false;

  useEffect(() => {
    if (!isUnread || markedId.current === id) {
      return;
    }
    markedId.current = id;
    const markAsRead = () => {
      mutate(
        { ids: [id] },
        {
          onError: (error) => {
            // Not suppressed for good: showing the message again retries.
            markedId.current = null;
            toast.show({
              variant: "danger",
              label: "Could not mark as read",
              description: errorMessage(error),
              actionLabel: "Try again",
              onActionPress: ({ hide }) => {
                hide();
                markedId.current = id;
                markAsRead();
              },
            });
          },
        },
      );
    };
    markAsRead();
  }, [id, isUnread, mutate, toast]);

  return query;
}
