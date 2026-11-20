import { PRIORITY_NAMES } from "@notifier/contract/priority";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Card, Separator, Typography, useToast } from "heroui-native";
import { ScrollView, View } from "react-native";

import { MessageActions } from "@/components/message-actions";
import { PriorityChip, TagChips } from "@/components/message-row";
import { ErrorState, LoadingState } from "@/components/query-state";
import { SenderAvatar } from "@/components/sender-avatar";
import { useMessage } from "@/hooks/use-inbox";
import { errorMessage } from "@/lib/errors";
import { fullTime, messageHeadline } from "@/lib/format";
import { openUrl } from "@/lib/open-url";

export default function MessageScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const query = useMessage(id);
  const { toast } = useToast();

  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="Could not load the message"
        onRetry={() => void query.refetch()}
      />
    );
  }

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
            const url = message.clickUrl;
            if (!url) {
              return;
            }
            openUrl(url).catch((error: unknown) => {
              toast.show({
                variant: "danger",
                label: errorMessage(error, "Could not open the link"),
              });
            });
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
