import type { MyTopic } from "@notifier/contract/topic";
import { useQuery } from "@tanstack/react-query";
import { Chip, ListGroup, Separator, useThemeColor } from "heroui-native";
import { Fragment, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { SenderAvatar } from "@/components/sender-avatar";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { orpc } from "@/utils/orpc";

function subscriptionLabel(topic: MyTopic): string | null {
  if (!topic.subscribed) {
    return "Not subscribed";
  }
  return topic.muted ? "Muted" : null;
}

function TopicRow({ topic }: { topic: MyTopic }) {
  const subscription = subscriptionLabel(topic);
  return (
    <ListGroup.Item
      accessibilityLabel={`${topic.displayName ?? topic.name}, ${topic.unreadCount} unread${subscription ? `, ${subscription}` : ""}`}
    >
      <ListGroup.ItemPrefix>
        <SenderAvatar topic={topic.name} conversation={null} sender={null} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>{topic.displayName ?? topic.name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {topic.displayName ? `${topic.name} · ${topic.role}` : topic.role}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <View className="flex-row items-center gap-1.5">
          {subscription ? (
            <Chip size="sm" variant="tertiary" color="default">
              <Chip.Label>{subscription}</Chip.Label>
            </Chip>
          ) : null}
          {topic.unreadCount > 0 ? (
            <Chip size="sm" variant="primary" color="accent">
              <Chip.Label>{topic.unreadCount > 99 ? "99+" : String(topic.unreadCount)}</Chip.Label>
            </Chip>
          ) : null}
        </View>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

export default function TopicsScreen() {
  const topics = useQuery(orpc.topics.list.queryOptions());
  const [accent] = useThemeColor(["accent"]);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(topics.refetch);

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await topics.refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }

  function renderContent() {
    if (topics.isPending) {
      return <LoadingState />;
    }
    if (topics.isError) {
      return <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />;
    }
    if (topics.data.length === 0) {
      return (
        <EmptyState title="No topics yet" pose="topics-empty">
          Topics you create or are invited to show up here.
        </EmptyState>
      );
    }
    return (
      <ListGroup>
        {topics.data.map((topic, index) => (
          <Fragment key={topic.id}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <TopicRow topic={topic} />
          </Fragment>
        ))}
      </ListGroup>
    );
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="grow p-4"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={isManualRefresh}
          onRefresh={() => void refresh()}
          colors={[accent]}
          tintColor={accent}
        />
      }
    >
      {renderContent()}
    </ScrollView>
  );
}
