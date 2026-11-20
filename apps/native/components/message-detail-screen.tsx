import { PRIORITY_NAMES } from "@notifier/contract/priority";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Card, Separator, Typography } from "heroui-native";
import { ScrollView, View } from "react-native";

import { MessageActions } from "@/components/message-actions";
import { PriorityChip, TagChips } from "@/components/message-row";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { SenderAvatar } from "@/components/sender-avatar";
import { useMessage } from "@/hooks/use-inbox";
import { useOpenLink } from "@/hooks/use-open-link";
import { isAccessError } from "@/lib/errors";
import { fullTime, messageHeadline } from "@/lib/format";

/** One message, opened from the inbox or from a topic; the route passes `id`. */
export function MessageDetailScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const query = useMessage(id);
  const openLink = useOpenLink();

  if (query.isPending) {
    return <LoadingState />;
  }
  // Gone or no longer ours: never keep showing a cached copy or its actions.
  if (isAccessError(query.error)) {
    return (
      <EmptyState title="Message not available">
        It was deleted, expired, or you no longer have access to its topic.
      </EmptyState>
    );
  }
  if (query.isError && !query.data) {
    return (
      <ErrorState
        error={query.error}
        title="Could not load the message"
        onRetry={() => void query.refetch()}
      />
    );
  }

  // A transient failure (network, 5xx) of a background refetch keeps the cached message.
  const message = query.data;
  const priorityName = PRIORITY_NAMES[message.priority as keyof typeof PRIORITY_NAMES];

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="gap-5 p-4"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: message.topic }} />

      <View className="flex-row items-center gap-3">
        <SenderAvatar
          topic={message.topic}
          conversation={message.conversation}
          sender={message.sender}
          size="lg"
        />
        <View className="flex-1 gap-0.5">
          <Typography weight="semibold" numberOfLines={1}>
            {messageHeadline(message)}
          </Typography>
          <Typography type="body-sm" color="muted">
            {message.topic} · {fullTime(message.createdAt)}
          </Typography>
          <Typography type="body-xs" color="muted">
            Priority {message.priority} ({priorityName})
          </Typography>
        </View>
      </View>

      {message.tags.length > 0 || message.priority >= 4 ? (
        <View className="flex-row flex-wrap gap-1.5">
          <PriorityChip priority={message.priority} />
          <TagChips tags={message.tags} />
        </View>
      ) : null}

      <Card>
        <Card.Body className="gap-2">
          {message.title ? (
            <Typography type="h4" selectable>
              {message.title}
            </Typography>
          ) : null}
          {message.body ? <Typography selectable>{message.body}</Typography> : null}
        </Card.Body>
      </Card>

      {message.clickUrl ? (
        <Button
          variant="outline"
          onPress={() => {
            if (message.clickUrl) {
              openLink(message.clickUrl);
            }
          }}
        >
          <Button.Label>Open link</Button.Label>
        </Button>
      ) : null}

      {message.actions.length > 0 ? (
        <>
          <Separator />
          <MessageActions message={message} />
        </>
      ) : null}
    </ScrollView>
  );
}
