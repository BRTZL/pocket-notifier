import { router } from "expo-router";
import { Chip, Separator, Spinner, useThemeColor } from "heroui-native";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { MessageRow } from "@/components/message-row";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useInbox } from "@/hooks/use-inbox";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";

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

  function renderEmpty() {
    if (inbox.isPending) {
      return <LoadingState />;
    }
    if (inbox.isError) {
      return <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />;
    }
    return filter === "unread" ? (
      <EmptyState title="All caught up">No unread messages.</EmptyState>
    ) : (
      <EmptyState title="No messages yet">
        Messages published to your topics show up here.
      </EmptyState>
    );
  }

  return (
    <FlatList
      className="bg-background flex-1"
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
      ListHeaderComponent={<FilterChips value={filter} onChange={setFilter} />}
      ListEmptyComponent={renderEmpty}
      ListFooterComponent={
        inbox.isFetchingNextPage ? (
          <View className="items-center py-4">
            <Spinner />
          </View>
        ) : null
      }
      onEndReached={() => {
        if (inbox.hasNextPage && !inbox.isFetchingNextPage) {
          void inbox.fetchNextPage();
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
