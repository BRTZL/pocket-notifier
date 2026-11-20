import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { ErrorState, LoadingState } from "@/components/query-state";
import { TopicDangerZone } from "@/components/topic-danger-zone";
import { TopicEditForm } from "@/components/topic-edit-form";
import { TopicMembers } from "@/components/topic-members";
import { TopicSubscription } from "@/components/topic-subscription";
import { InvalidTopicLink, TopicUnavailable } from "@/components/topic-unavailable";
import { useTopic, useTopicIdParam } from "@/hooks/use-topic";
import { isAccessError } from "@/lib/errors";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Typography type="body-sm" weight="semibold" color="muted" className="px-1 uppercase">
        {title}
      </Typography>
      {children}
    </View>
  );
}

function TopicSettingsScreenContent({ topicId }: { topicId: string }) {
  const topic = useTopic(topicId);

  if (topic.isPending) {
    return <LoadingState />;
  }
  if (isAccessError(topic.error)) {
    return <TopicUnavailable />;
  }
  if (topic.isError && !topic.data) {
    return <ErrorState error={topic.error} onRetry={() => void topic.refetch()} />;
  }

  const isOwner = topic.data.role === "owner";
  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Notifications">
        <TopicSubscription topic={topic.data} />
      </Section>
      {isOwner ? (
        <Section title="Settings">
          <TopicEditForm key={topic.data.id} topic={topic.data} />
        </Section>
      ) : null}
      <Section title="People">
        <TopicMembers topic={topic.data} />
      </Section>
      <TopicDangerZone topic={topic.data} />
    </KeyboardAwareScrollView>
  );
}

export default function TopicSettingsScreen() {
  const topicId = useTopicIdParam();
  return topicId ? <TopicSettingsScreenContent topicId={topicId} /> : <InvalidTopicLink />;
}
