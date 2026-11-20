import type { MyProject } from "@notifier/contract/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, ControlField, Description, Label, Separator, useToast } from "heroui-native";
import { useRef } from "react";
import { View } from "react-native";

import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The signed-in user's own push settings for a project. */
export function ProjectSubscription({ project }: { project: MyProject }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation(
    orpc.projects.setSubscription.mutationOptions({
      // Refetch rather than write the response over the cache: it may be older than an
      // edit of the project's details that finished meanwhile. The switches keep showing the
      // sent values until the refetch lands, since the mutation stays pending until then.
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.projects.get.queryKey({ input: { id: project.id } }),
          }),
          queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() }),
        ]);
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not save") });
      },
    }),
  );
  // Show the change right away while it is saved.
  const subscribed = mutation.isPending ? mutation.variables.subscribed : project.subscribed;
  const muted = mutation.isPending ? Boolean(mutation.variables.muted) : project.muted;

  // One synchronous lock for both switches: a second toggle before the first settles
  // would be computed from stale values.
  const saveLock = useRef(false);

  function save(next: { subscribed: boolean; muted: boolean }) {
    if (saveLock.current) {
      return;
    }
    saveLock.current = true;
    mutation.mutate(
      { projectId: project.id, ...next },
      {
        onSettled: () => {
          saveLock.current = false;
        },
      },
    );
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
            <Description>Your devices get push notifications for this project.</Description>
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
