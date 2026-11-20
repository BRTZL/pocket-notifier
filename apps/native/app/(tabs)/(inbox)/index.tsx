import type { ConversationSummary } from "@notifier/contract/conversation";
import { router } from "expo-router";
import { Button, Menu, SearchField, Spinner, useThemeColor } from "heroui-native";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { ConversationRow } from "@/components/conversation-row";
import { Icon } from "@/components/icon";
import { EmptyState, ErrorState, LoadErrorBanner, LoadingState } from "@/components/query-state";
import { ScreenHeader } from "@/components/screen-header";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { useConversations, useMarkAllRead } from "@/hooks/use-conversations";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage } from "@/lib/errors";

/** Case-insensitive match on the name, topic, sender and last message. */
function matches(conversation: ConversationSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const { title, body, senderName } = conversation.lastMessage;
  return [conversation.title, conversation.topic, title, body, senderName].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

function InboxMenu({ newestMessageId }: { newestMessageId: string | null }) {
  const { markAllRead, isPending } = useMarkAllRead();
  return (
    <Menu>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          isIconOnly
          className="size-12 rounded-full"
          accessibilityLabel="More options"
        >
          <Icon name="more-vert" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content presentation="popover" width={220}>
          <Menu.Item
            isDisabled={newestMessageId === null || isPending}
            onPress={() => {
              if (newestMessageId) {
                markAllRead(newestMessageId);
              }
            }}
          >
            <Menu.ItemTitle>Mark all read</Menu.ItemTitle>
          </Menu.Item>
          <Menu.Item onPress={() => router.navigate("/(tabs)/(settings)")}>
            <Menu.ItemTitle>Settings</Menu.ItemTitle>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

export default function InboxScreen() {
  const { query, conversations } = useConversations();
  const [search, setSearch] = useState("");
  const [accent] = useThemeColor(["accent"]);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(query.refetch);
  const visible = conversations.filter((conversation) => matches(conversation, search));
  // The list is newest first, so the first row holds the newest message.
  const newestMessageId = conversations[0]?.lastMessage.id ?? null;

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await query.refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }

  function renderEmpty() {
    if (query.isPending) {
      return <LoadingState />;
    }
    if (query.isError) {
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    if (conversations.length > 0) {
      return <EmptyState title="No matches">Nothing in your inbox mentions “{search}”.</EmptyState>;
    }
    return (
      <EmptyState title="All caught up" pose="inbox-empty">
        When an agent or script publishes to your topics, its project shows up here as a chat.
      </EmptyState>
    );
  }

  function renderFooter() {
    if (query.isFetchingNextPage) {
      return (
        <View className="items-center py-4">
          <Spinner />
        </View>
      );
    }
    if (conversations.length > 0 && query.isFetchNextPageError) {
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

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Inbox" right={<InboxMenu newestMessageId={newestMessageId} />} />
      <SearchField value={search} onChange={setSearch} className="mx-4 mt-1 mb-2">
        <SearchField.Group>
          <SearchField.SearchIcon>
            <Icon name="search" size={22} color="muted" />
          </SearchField.SearchIcon>
          <SearchField.Input
            variant="secondary"
            placeholder="Search projects and messages"
            className="bg-surface h-[52px] rounded-full pl-[52px] text-[16px]"
            accessibilityLabel="Search projects and messages"
          />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <FlatList
        className="flex-1"
        contentContainerClassName="grow pt-1 pb-4"
        keyboardShouldPersistTaps="handled"
        data={visible}
        keyExtractor={(conversation) => `${conversation.topicId}/${conversation.key}`}
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            onPress={() =>
              router.push({
                pathname: "/conversation/[topicId]/[key]",
                params: { topicId: item.topicId, key: item.key, title: item.title },
              })
            }
          />
        )}
        ListHeaderComponent={
          conversations.length > 0 && query.isRefetchError ? (
            <LoadErrorBanner
              title="Could not refresh"
              description={errorMessage(query.error)}
              onRetry={() => void refresh()}
            />
          ) : null
        }
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter()}
        onEndReached={() => {
          // Same guards as the message list: no fetch while another runs, and no retry loop
          // after a failed page (its footer has "Try again").
          if (query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) {
            void query.fetchNextPage({ cancelRefetch: false });
          }
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <ThemedRefreshControl refreshing={isManualRefresh} onRefresh={() => void refresh()} />
        }
      />
    </View>
  );
}
