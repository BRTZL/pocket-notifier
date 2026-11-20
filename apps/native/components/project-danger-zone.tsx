import type { MyProject } from "@notifier/contract/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card, useToast } from "heroui-native";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/**
 * "Leave project" for everyone but owners, "Delete project" for owners. Both end on the
 * project list: the project's own screens would only show "not available" afterwards.
 */
export function ProjectDangerZone({ project }: { project: MyProject }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = authClient.useSession();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const isOwner = project.role === "owner";

  async function leaveScreens(label: string) {
    setIsConfirmOpen(false);
    // Back to the project list (the stack's anchor), whatever opened the project: a deep link
    // may have put the project screens on top of it.
    router.dismissTo("/(tabs)/(projects)");
    toast.show({ variant: "success", label });
    // The project's own data must not linger: drop it, then refresh the lists that showed it.
    queryClient.removeQueries({
      queryKey: orpc.projects.get.queryKey({ input: { id: project.id } }),
    });
    queryClient.removeQueries({
      queryKey: orpc.members.list.key({ input: { projectId: project.id } }),
    });
    queryClient.removeQueries({
      queryKey: orpc.messages.list.key({ input: { projectId: project.id } }),
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.messages.list.key() }),
    ]);
  }
  const onError = (fallback: string) => (error: unknown) => {
    setIsConfirmOpen(false);
    toast.show({ variant: "danger", label: errorMessage(error, fallback) });
  };

  const remove = useMutation(
    orpc.projects.delete.mutationOptions({
      onSuccess: () => leaveScreens(`Deleted ${project.name}`),
      onError: onError("Could not delete the project"),
    }),
  );
  const leave = useMutation(
    orpc.members.remove.mutationOptions({
      onSuccess: () => leaveScreens(`Left ${project.name}`),
      onError: onError("Could not leave the project"),
    }),
  );
  const isPending = remove.isPending || leave.isPending;

  function confirm() {
    if (isOwner) {
      remove.mutate({ id: project.id });
    } else if (session) {
      leave.mutate({ projectId: project.id, userId: session.user.id });
    }
  }

  return (
    <Card>
      <Card.Body className="gap-3">
        <Card.Title>{isOwner ? "Delete project" : "Leave project"}</Card.Title>
        <Card.Description>
          {isOwner
            ? "Deletes the project and all of its messages for every member. This cannot be undone."
            : "You stop seeing its messages. An owner can add you again."}
        </Card.Description>
        <Button variant="danger-soft" onPress={() => setIsConfirmOpen(true)} isDisabled={isPending}>
          <Button.Label>{isOwner ? "Delete project" : "Leave project"}</Button.Label>
        </Button>
      </Card.Body>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={isOwner ? `Delete ${project.name}?` : `Leave ${project.name}?`}
        description={
          isOwner
            ? "Every member loses the project and its messages, and tokens can no longer publish to it."
            : "The project and its messages disappear from your inbox."
        }
        confirmLabel={isOwner ? "Delete" : "Leave"}
        isPending={isPending}
        onConfirm={confirm}
      />
    </Card>
  );
}
