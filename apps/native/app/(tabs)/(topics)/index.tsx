import type { MyTopic } from "@notifier/contract/topic";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, cn, PressableFeedback, Typography } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ChatAvatar } from "@/components/chat-avatar";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { HeaderIconButton, ScreenHeader } from "@/components/screen-header";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { topicGlyph } from "@/lib/chat-avatar";
import { orpc } from "@/utils/orpc";

function subscriptionLabel(topic: MyTopic): string | null {
  if (!topic.subscribed) {
    return "Not subscribed";
  }
  return topic.muted ? "Muted" : null;
}

function TopicRow({ topic }: { topic: MyTopic }) {
  const subscription = subscriptionLabel(topic);
  const title = topic.displayName ?? topic.name;
  const unread = topic.unreadCount > 0;
  const details = [topic.displayName ? topic.name : null, topic.role, subscription]
    .filter(Boolean)
    .join(" · ");
  return (
    <PressableFeedback
      animation={false}
      onPress={() => router.push({ pathname: "/topic/[topicId]", params: { topicId: topic.id } })}
      className="flex-row items-center gap-3.5 px-5 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${topic.unreadCount} unread${subscription ? `, ${subscription}` : ""}`}
    >
      <PressableFeedback.Highlight />
      <ChatAvatar subject={{ kind: "glyph", name: title, glyph: topicGlyph(topic.name) }} />
      <View className="min-w-0 flex-1">
        <Typography
          numberOfLines={1}
          className={cn("text-[17px] leading-[22px]", unread ? "font-heavy" : "font-semibold")}
        >
          {title}
        </Typography>
        <Typography numberOfLines={1} className="text-muted mt-[3px] text-[15px] leading-[21px]">
          {details}
        </Typography>
      </View>
      {unread ? (
        <View
          className={cn(
            "h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px]",
            topic.muted || !topic.subscribed ? "bg-surface-tertiary" : "bg-accent",
          )}
        >
          <Typography
            className={cn(
              "text-[12.5px] leading-4 font-bold",
              topic.muted || !topic.subscribed ? "text-muted" : "text-accent-foreground",
            )}
          >
            {topic.unreadCount > 99 ? "99+" : String(topic.unreadCount)}
          </Typography>
        </View>
      ) : null}
    </PressableFeedback>
  );
}

export default function TopicsScreen() {
  const topics = useQuery(orpc.topics.list.queryOptions());
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
        <View className="gap-4 px-5">
          <EmptyState title="No topics yet" pose="topics-empty">
            Topics you create or are invited to show up here.
          </EmptyState>
          <Button className="h-[52px] rounded-full" onPress={() => router.push("/new")}>
            <Button.Label>Create a topic</Button.Label>
          </Button>
        </View>
      );
    }
    return (
      <View>
        {topics.data.map((topic) => (
          <TopicRow key={topic.id} topic={topic} />
        ))}
      </View>
    );
  }

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title="Topics"
        right={
          <HeaderIconButton icon="add" label="New topic" onPress={() => router.push("/new")} />
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow pt-1 pb-6"
        refreshControl={
          <ThemedRefreshControl refreshing={isManualRefresh} onRefresh={() => void refresh()} />
        }
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
}
