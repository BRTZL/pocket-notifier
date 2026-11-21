import type { MyProject } from "@notifier/contract/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, Spinner, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";

import { ChatAvatar } from "@/components/chat-avatar";
import { projectTitle } from "@/hooks/use-project";
import { projectAvatar } from "@/lib/chat-avatar";
import { errorMessage } from "@/lib/errors";
import { encodeProjectIcon } from "@/lib/project-icon";
import { orpc } from "@/utils/orpc";

/**
 * Owner-only: the project's icon, shown in the inbox, the project list and its
 * notifications. "Choose image" picks a photo (square crop), resizes it to 256 px and
 * uploads it; "Remove" goes back to the generated avatar.
 */
export function ProjectIconEditor({ project }: { project: MyProject }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isPreparing, setIsPreparing] = useState(false);

  async function refresh() {
    // Every list that draws the icon: projects, and conversation summaries (inbox rows and
    // thread headers carry the project icon).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.conversations.key() }),
    ]);
  }

  const upload = useMutation(
    orpc.projects.setIcon.mutationOptions({
      onSuccess: async (updated) => {
        queryClient.setQueryData(
          orpc.projects.get.queryKey({ input: { id: project.id } }),
          updated,
        );
        await refresh();
        toast.show({ variant: "success", label: "Icon updated" });
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not upload the icon") });
      },
    }),
  );
  const remove = useMutation(
    orpc.projects.update.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.show({ variant: "success", label: "Icon removed" });
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not remove the icon") });
      },
    }),
  );
  const isBusy = isPreparing || upload.isPending || remove.isPending;

  async function choose() {
    if (isBusy) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) {
      return;
    }
    setIsPreparing(true);
    try {
      const icon = await encodeProjectIcon(asset);
      if (!icon) {
        toast.show({ variant: "danger", label: "That image is too large to use as an icon" });
        return;
      }
      upload.mutate({ id: project.id, ...icon });
    } catch {
      toast.show({ variant: "danger", label: "Could not read that image" });
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <Card>
      <Card.Body className="gap-4">
        <Card.Title>Icon</Card.Title>
        <View className="flex-row items-center gap-4">
          <ChatAvatar subject={projectAvatar(project)} size={64} />
          <Typography type="body-sm" color="muted" className="flex-1">
            Shown for {projectTitle(project)} in the inbox and in notifications. Without one, a
            generated avatar is used.
          </Typography>
        </View>
        <View className="flex-row gap-2">
          <Button className="flex-1" onPress={() => void choose()} isDisabled={isBusy}>
            {isPreparing || upload.isPending ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Button.Label>{project.iconUrl ? "Change image" : "Choose image"}</Button.Label>
            )}
          </Button>
          {project.iconUrl ? (
            <Button
              variant="danger-soft"
              onPress={() => remove.mutate({ id: project.id, iconUrl: null })}
              isDisabled={isBusy}
            >
              {remove.isPending ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Button.Label>Remove</Button.Label>
              )}
            </Button>
          ) : null}
        </View>
      </Card.Body>
    </Card>
  );
}
