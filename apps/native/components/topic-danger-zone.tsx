import type { MyTopic } from "@notifier/contract/topic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card, useToast } from "heroui-native";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/**
 * "Leave topic" for everyone but owners, "Delete topic" for owners. Both end on the
 * topic list: the topic's own screens would only show "not available" afterwards.
 */
export function TopicDangerZone({ topic }: { topic: MyTopic }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = authClient.useSession();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const isOwner = topic.role === "owner";

  async function leaveScreens(label: string) {
    setIsConfirmOpen(false);
    // Back to the topic list (the stack's anchor), whatever opened the topic: a deep link
    // may have put the topic screens on top of it.
    router.dismissTo("/(tabs)/(topics)");
    toast.show({ variant: "success", label });
    // The topic's own data must not linger: drop it, then refresh the lists that showed it.
    queryClient.removeQueries({ queryKey: orpc.topics.get.queryKey({ input: { id: topic.id } }) });
    queryClient.removeQueries({
      queryKey: orpc.members.list.key({ input: { topicId: topic.id } }),
    });
    queryClient.removeQueries({
      queryKey: orpc.messages.list.key({ input: { topicId: topic.id } }),
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.topics.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.messages.list.key() }),
    ]);
  }
  const onError = (fallback: string) => (error: unknown) => {
    setIsConfirmOpen(false);
    toast.show({ variant: "danger", label: errorMessage(error, fallback) });
  };

  const remove = useMutation(
    orpc.topics.delete.mutationOptions({
      onSuccess: () => leaveScreens(`Deleted ${topic.name}`),
      onError: onError("Could not delete the topic"),
    }),
  );
  const leave = useMutation(
    orpc.members.remove.mutationOptions({
      onSuccess: () => leaveScreens(`Left ${topic.name}`),
      onError: onError("Could not leave the topic"),
    }),
  );
  const isPending = remove.isPending || leave.isPending;

  function confirm() {
    if (isOwner) {
      remove.mutate({ id: topic.id });
    } else if (session) {
      leave.mutate({ topicId: topic.id, userId: session.user.id });
    }
  }

  return (
    <Card>
      <Card.Body className="gap-3">
        <Card.Title>{isOwner ? "Delete topic" : "Leave topic"}</Card.Title>
        <Card.Description>
          {isOwner
            ? "Deletes the topic and all of its messages for every member. This cannot be undone."
            : "You stop seeing its messages. An owner can add you again."}
        </Card.Description>
        <Button variant="danger-soft" onPress={() => setIsConfirmOpen(true)} isDisabled={isPending}>
          <Button.Label>{isOwner ? "Delete topic" : "Leave topic"}</Button.Label>
        </Button>
      </Card.Body>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={isOwner ? `Delete ${topic.name}?` : `Leave ${topic.name}?`}
        description={
          isOwner
            ? "Every member loses the topic and its messages, and tokens can no longer publish to it."
            : "The topic and its messages disappear from your inbox."
        }
        confirmLabel={isOwner ? "Delete" : "Leave"}
        isPending={isPending}
        onConfirm={confirm}
      />
    </Card>
  );
}
