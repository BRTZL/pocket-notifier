import type { InboxMessage } from "@notifier/contract/message";
import { Separator, Spinner, useThemeColor } from "heroui-native";
import { type ReactElement, useState } from "react";
import { FlatList, View } from "react-native";
import { MessageRow } from "@/components/message-row";
import { EmptyState, ErrorState, LoadErrorBanner, LoadingState } from "@/components/query-state";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { useInbox } from "@/hooks/use-inbox";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage, isAccessError } from "@/lib/errors";

export type MessageListProps = {
  /** One topic's messages; the combined inbox when omitted. */
  topicId?: string;
  unreadOnly?: boolean;
  /** Rendered above the rows (filters, a topic header). */
  header?: ReactElement;
  /** Shown when the list loaded and is empty. */
  empty: ReactElement;
  /** Shown instead of any rows once the API says they are gone or no longer ours. */
  unavailable?: ReactElement;
  onOpenMessage: (message: InboxMessage) => void;
};

/**
 * Messages newest first, paged with `nextCursor`, with pull-to-refresh, a refetch when
 * the screen regains focus, and inline errors that keep rows already on screen.
 */
export function MessageList({
  topicId,
  unreadOnly = false,
  header,
  empty,
  unavailable,
  onOpenMessage,
}: MessageListProps) {
  const { query, messages: loaded } = useInbox({ unreadOnly, topicId });
  // A refresh that answers "not found" or "forbidden" means access is gone: cached rows
  // must not stay on screen.
  const isUnavailable = isAccessError(query.error);
  const messages = isUnavailable ? [] : loaded;
  const [accent] = useThemeColor(["accent"]);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(query.refetch);

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await query.refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }

  function renderFooter() {
    if (query.isFetchingNextPage) {
      return (
        <View className="items-center py-4">
          <Spinner />
        </View>
      );
    }
    if (messages.length > 0 && query.isFetchNextPageError) {
      return (
        <LoadErrorBanner
          title="Could not load more"
          description={errorMessage(query.error)}
          onRetry={() => void query.fetchNextPage({ cancelRefetch: false })}
        />
      );
    }
    return null;
  }

  function renderEmpty() {
    if (isUnavailable) {
      return (
        unavailable ?? (
          <EmptyState title="Messages not available" pose="error">
            You no longer have access to these messages.
          </EmptyState>
        )
      );
    }
    if (query.isPending) {
      return <LoadingState />;
    }
    if (query.isError) {
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    return empty;
  }

  return (
    <FlatList
      className="bg-background flex-1"
      contentContainerClassName="grow"
      contentInsetAdjustmentBehavior="automatic"
      data={messages}
      keyExtractor={(message) => message.id}
      renderItem={({ item }) => <MessageRow message={item} onPress={() => onOpenMessage(item)} />}
      ItemSeparatorComponent={() => <Separator className="ml-20" />}
      ListHeaderComponent={
        <>
          {header}
          {messages.length > 0 && query.isRefetchError ? (
            <LoadErrorBanner
              title="Could not refresh"
              description={errorMessage(query.error)}
              onRetry={() => void refresh()}
            />
          ) : null}
        </>
      }
      ListEmptyComponent={renderEmpty}
      ListFooterComponent={renderFooter()}
      onEndReached={() => {
        // After a failed page the footer's "Try again" retries; reaching the end again must
        // not, or the error footer itself re-triggers the fetch in a loop.
        // Not while any fetch runs (a refresh refetches every loaded page), and without
        // cancelling one that is already running.
        if (query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) {
          void query.fetchNextPage({ cancelRefetch: false });
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <ThemedRefreshControl refreshing={isManualRefresh} onRefresh={() => void refresh()} />
      }
    />
  );
}
