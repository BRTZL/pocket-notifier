import { router } from "expo-router";
import { Alert, Button, Chip, Separator, Spinner, useThemeColor } from "heroui-native";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { MessageRow } from "@/components/message-row";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useInbox } from "@/hooks/use-inbox";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage } from "@/lib/errors";

type Filter = "all" | "unread";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
];

function FilterChips({ value, onChange }: { value: Filter; onChange: (filter: Filter) => void }) {
  return (
    <View className="flex-row gap-2 px-4 pt-2 pb-3" accessibilityRole="tablist">
      {FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Chip
            key={filter.key}
            variant={selected ? "primary" : "secondary"}
            color={selected ? "accent" : "default"}
            onPress={() => onChange(filter.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Chip.Label>{filter.label}</Chip.Label>
          </Chip>
        );
      })}
    </View>
  );
}

/**
 * Shown above rows that are already on screen when a refresh or the next page fails;
 * "Try again" repeats the operation that failed.
 */
function LoadErrorBanner({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-2 px-4 pb-3">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert.Content>
      </Alert>
      <Button size="sm" variant="secondary" onPress={onRetry}>
        <Button.Label>Try again</Button.Label>
      </Button>
    </View>
  );
}

export default function InboxScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const { query: inbox, messages } = useInbox({ unreadOnly: filter === "unread" });
  const [accent] = useThemeColor(["accent"]);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(inbox.refetch);

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await inbox.refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }

  function renderFooter() {
    if (inbox.isFetchingNextPage) {
      return (
        <View className="items-center py-4">
          <Spinner />
        </View>
      );
    }
    if (messages.length > 0 && inbox.isFetchNextPageError) {
      return (
        <LoadErrorBanner
          title="Could not load more"
          description={errorMessage(inbox.error)}
          onRetry={() => void inbox.fetchNextPage({ cancelRefetch: false })}
        />
      );
    }
    return null;
  }

  function renderEmpty() {
    if (inbox.isPending) {
      return <LoadingState />;
    }
    if (inbox.isError) {
      return <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />;
    }
    return filter === "unread" ? (
      <EmptyState title="All caught up" pose="inbox-empty">
        No unread messages.
      </EmptyState>
    ) : (
      <EmptyState title="All caught up" pose="inbox-empty">
        Nothing here yet. Messages published to your topics show up here.
      </EmptyState>
    );
  }

  return (
    <FlatList
      className="bg-background flex-1"
      contentContainerClassName="grow"
      contentInsetAdjustmentBehavior="automatic"
      data={messages}
      keyExtractor={(message) => message.id}
      renderItem={({ item }) => (
        <MessageRow
          message={item}
          onPress={() => router.push({ pathname: "/message/[id]", params: { id: item.id } })}
        />
      )}
      ItemSeparatorComponent={() => <Separator className="ml-20" />}
      ListHeaderComponent={
        <>
          <FilterChips value={filter} onChange={setFilter} />
          {messages.length > 0 && inbox.isRefetchError ? (
            <LoadErrorBanner
              title="Could not refresh"
              description={errorMessage(inbox.error)}
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
        if (inbox.hasNextPage && !inbox.isFetching && !inbox.isFetchNextPageError) {
          void inbox.fetchNextPage({ cancelRefetch: false });
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={isManualRefresh}
          onRefresh={() => void refresh()}
          colors={[accent]}
          tintColor={accent}
        />
      }
    />
  );
}
