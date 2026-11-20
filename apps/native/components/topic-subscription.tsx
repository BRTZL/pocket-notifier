import type { MyTopic } from "@notifier/contract/topic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, ControlField, Description, Label, Separator, useToast } from "heroui-native";
import { View } from "react-native";

import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The signed-in user's own push settings for a topic. */
export function TopicSubscription({ topic }: { topic: MyTopic }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation(
    orpc.topics.setSubscription.mutationOptions({
      onSuccess: async (updated) => {
        queryClient.setQueryData(orpc.topics.get.queryKey({ input: { id: updated.id } }), updated);
        await queryClient.invalidateQueries({ queryKey: orpc.topics.list.key() });
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not save") });
      },
    }),
  );
  // Show the change right away while it is saved.
  const subscribed = mutation.isPending ? mutation.variables.subscribed : topic.subscribed;
  const muted = mutation.isPending ? Boolean(mutation.variables.muted) : topic.muted;

  function save(next: { subscribed: boolean; muted: boolean }) {
    mutation.mutate({ topicId: topic.id, ...next });
  }

  return (
    <Card>
      <Card.Body className="gap-3">
        <ControlField
          isSelected={subscribed}
          isDisabled={mutation.isPending}
          onSelectedChange={(value) => save({ subscribed: value, muted: value ? muted : false })}
        >
          <View className="flex-1">
            <Label>Subscribed</Label>
            <Description>Your devices get push notifications for this topic.</Description>
          </View>
          <ControlField.Indicator />
        </ControlField>
        <Separator />
        <ControlField
          isSelected={muted}
          isDisabled={mutation.isPending || !subscribed}
          onSelectedChange={(value) => save({ subscribed, muted: value })}
        >
          <View className="flex-1">
            <Label>Muted</Label>
            <Description>Messages still land in your inbox, without a push.</Description>
          </View>
          <ControlField.Indicator />
        </ControlField>
      </Card.Body>
    </Card>
  );
}
