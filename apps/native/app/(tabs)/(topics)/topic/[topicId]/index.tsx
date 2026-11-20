import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { View } from "react-native";

import { MessageList } from "@/components/message-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { SenderAvatar } from "@/components/sender-avatar";
import { topicTitle, useTopic } from "@/hooks/use-topic";
import { isAccessError } from "@/lib/errors";

function TopicHeaderTitle({ name, title }: { name: string; title: string }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <SenderAvatar topic={name} conversation={null} sender={null} />
      <View>
        <Typography weight="semibold" numberOfLines={1}>
          {title}
        </Typography>
        {title === name ? null : (
          <Typography type="body-xs" color="muted" numberOfLines={1}>
            {name}
          </Typography>
        )}
      </View>
    </View>
  );
}

export default function TopicScreen() {
  const { topicId = "" } = useLocalSearchParams<{ topicId: string }>();
  const topic = useTopic(topicId);

  if (topic.isPending) {
    return <LoadingState />;
  }
  if (isAccessError(topic.error)) {
    return (
      <EmptyState title="Topic not available" pose="error">
        It was deleted, or you are no longer a member.
      </EmptyState>
    );
  }
  if (topic.isError && !topic.data) {
    return <ErrorState error={topic.error} onRetry={() => void topic.refetch()} />;
  }

  const { name, description } = topic.data;
  const title = topicTitle(topic.data);
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => <TopicHeaderTitle name={name} title={title} />,
          headerRight: () => (
            <Button
              size="sm"
              variant="ghost"
              onPress={() =>
                router.push({ pathname: "/topic/[topicId]/settings", params: { topicId } })
              }
            >
              <Button.Label>Settings</Button.Label>
            </Button>
          ),
        }}
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
    </>
  );
}
