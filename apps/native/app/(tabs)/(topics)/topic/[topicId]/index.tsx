import { router } from "expo-router";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { MessageList } from "@/components/message-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { HeaderIconButton, StackHeader } from "@/components/screen-header";
import { InvalidTopicLink, TopicUnavailable } from "@/components/topic-unavailable";
import { topicTitle, useTopic, useTopicIdParam } from "@/hooks/use-topic";
import { topicGlyph } from "@/lib/chat-avatar";
import { isAccessError } from "@/lib/errors";

function TopicScreenContent({ topicId }: { topicId: string }) {
  const topic = useTopic(topicId);

  if (topic.isPending || isAccessError(topic.error) || (topic.isError && !topic.data)) {
    return (
      <View className="bg-background flex-1">
        <StackHeader title="Topic" />
        {topic.isPending ? (
          <LoadingState />
        ) : isAccessError(topic.error) ? (
          <TopicUnavailable />
        ) : (
          <ErrorState error={topic.error} onRetry={() => void topic.refetch()} />
        )}
      </View>
    );
  }

  const { name, description } = topic.data;
  const title = topicTitle(topic.data);
  return (
    <View className="bg-background flex-1">
      <StackHeader
        title={title}
        subtitle={title === name ? null : name}
        avatar={{ kind: "glyph", name: title, glyph: topicGlyph(name) }}
        right={
          <HeaderIconButton
            icon="tune"
            label="Topic settings"
            onPress={() =>
              router.push({ pathname: "/topic/[topicId]/settings", params: { topicId } })
            }
          />
        }
      />
      <MessageList
        topicId={topicId}
        header={
          description ? (
            <Typography type="body-sm" color="muted" className="px-4 pt-2 pb-3">
              {description}
            </Typography>
          ) : undefined
        }
        unavailable={<TopicUnavailable />}
        empty={
          <EmptyState title="No messages yet" pose="inbox-empty">
            Messages published to {name} show up here.
          </EmptyState>
        }
        onOpenMessage={(message) =>
          router.push({
            pathname: "/topic/[topicId]/message/[id]",
            params: { topicId, id: message.id },
          })
        }
      />
    </View>
  );
}

export default function TopicScreen() {
  const topicId = useTopicIdParam();
  if (!topicId) {
    return (
      <View className="bg-background flex-1">
        <StackHeader title="Topic" />
        <InvalidTopicLink />
      </View>
    );
  }
  return <TopicScreenContent topicId={topicId} />;
}
