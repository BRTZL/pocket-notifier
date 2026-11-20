import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

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

/** One message; marks it read the first time it is shown unread. */
export function useMessage(id: string) {
  const query = useQuery(orpc.messages.get.queryOptions({ input: { id } }));
  const invalidateInbox = useInvalidateInbox();
  const markRead = useMutation(
    orpc.messages.markRead.mutationOptions({
      onSuccess: async () => {
        await invalidateInbox();
      },
    }),
  );
  const markedId = useRef<string | null>(null);
  const isUnread = query.data?.read === false;
  const { mutate } = markRead;

  useEffect(() => {
    if (!isUnread || markedId.current === id) {
      return;
    }
    markedId.current = id;
    mutate({ ids: [id] });
  }, [id, isUnread, mutate]);

  return query;
}
