import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "heroui-native";
import { useEffect, useRef } from "react";

import { authClient, currentUserId } from "@/lib/auth-client";
import { errorMessage, isAccessError } from "@/lib/errors";
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

/** Per-message key, so marks of the same message can be found while in flight. */
function markReadMutationKey(id: string) {
  return [...orpc.messages.markRead.mutationKey(), id];
}

/**
 * One message; marks it read the first time it is shown unread.
 *
 * - On success the cached message becomes `read: true`, so it is not marked again.
 * - Marks are deduped per message id within this user's query client: a mark already
 *   in flight (e.g. from a quick back-and-forward) is not sent twice.
 * - On failure a toast offers "Try again". The toast is dismissed when this screen
 *   unmounts (which includes a user change, since the cache is per user), and its retry
 *   does nothing if the signed-in user is no longer the one who opened the message.
 */
export function useMessage(id: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...orpc.messages.get.queryOptions({ input: { id } }),
    // Retrying "not found" or "forbidden" only delays the not-available state.
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 3,
  });
  const invalidateInbox = useInvalidateInbox();
  const { toast } = useToast();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const { mutate } = useMutation({
    ...orpc.messages.markRead.mutationOptions({
      onSuccess: async () => {
        queryClient.setQueryData(orpc.messages.get.queryKey({ input: { id } }), (message) =>
          message ? { ...message, read: true } : message,
        );
        await invalidateInbox();
      },
    }),
    mutationKey: markReadMutationKey(id),
  });
  const markedId = useRef<string | null>(null);
  const toastId = useRef<string | null>(null);
  const isUnread = query.data?.read === false;

  useEffect(() => {
    if (!isUnread || markedId.current === id || userId === null) {
      return;
    }
    if (queryClient.isMutating({ mutationKey: markReadMutationKey(id) }) > 0) {
      return;
    }
    markedId.current = id;
    const openedBy = userId;
    const markAsRead = () => {
      mutate(
        { ids: [id] },
        {
          onError: (error) => {
            // Not suppressed for good: showing the message again retries.
            markedId.current = null;
            toastId.current = toast.show({
              variant: "danger",
              label: "Could not mark as read",
              description: errorMessage(error),
              actionLabel: "Try again",
              onActionPress: ({ hide }) => {
                hide();
                toastId.current = null;
                if (currentUserId() !== openedBy) {
                  return;
                }
                markedId.current = id;
                markAsRead();
              },
            });
          },
        },
      );
    };
    markAsRead();
  }, [id, isUnread, mutate, toast, userId, queryClient]);

  // The failure toast belongs to this screen: it must not outlive it.
  useEffect(
    () => () => {
      if (toastId.current) {
        toast.hide(toastId.current);
        toastId.current = null;
      }
    },
    [toast],
  );

  return query;
}
