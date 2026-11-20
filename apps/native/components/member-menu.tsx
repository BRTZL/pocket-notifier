import type { ProjectMember, ProjectRole } from "@notifier/contract/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Menu, useToast } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

const ROLES: { role: ProjectRole; description: string }[] = [
  { role: "owner", description: "Manages the project and its members" },
  { role: "publisher", description: "Publishes and reads history" },
  { role: "subscriber", description: "Reads history and gets pushes" },
];

function roleTitle(role: ProjectRole, current: ProjectRole): string {
  return role === current ? `${role} (current)` : role;
}

/** Owner actions on another member: change the role or remove them. */
export function MemberMenu({ member }: { member: ProjectMember }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const membersKey = orpc.members.list.queryKey({ input: { projectId: member.projectId } });
  const onError = (fallback: string) => (error: unknown) => {
    toast.show({ variant: "danger", label: errorMessage(error, fallback) });
  };

  const update = useMutation(
    orpc.members.update.mutationOptions({
      onSuccess: async (updated) => {
        await queryClient.invalidateQueries({ queryKey: membersKey });
        toast.show({ variant: "success", label: `${updated.user.name} is now ${updated.role}` });
      },
      onError: onError("Could not change the role"),
    }),
  );
  const remove = useMutation(
    orpc.members.remove.mutationOptions({
      onSuccess: async () => {
        setIsConfirmOpen(false);
        await queryClient.invalidateQueries({ queryKey: membersKey });
        toast.show({ variant: "success", label: `Removed ${member.user.name}` });
      },
      onError: (error) => {
        setIsConfirmOpen(false);
        onError("Could not remove the member")(error);
      },
    }),
  );

  return (
    <>
      <Menu>
        <Menu.Trigger asChild>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={update.isPending || remove.isPending}
            accessibilityLabel={`Manage ${member.user.name}`}
          >
            <Button.Label>Manage</Button.Label>
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Overlay />
          <Menu.Content presentation="popover" width={260}>
            <Menu.Label>Role</Menu.Label>
            {ROLES.map(({ role, description }) => (
              <Menu.Item
                key={role}
                isDisabled={role === member.role}
                onPress={() =>
                  update.mutate({ projectId: member.projectId, userId: member.user.id, role })
                }
              >
                <View className="flex-1">
                  <Menu.ItemTitle>{roleTitle(role, member.role)}</Menu.ItemTitle>
                  <Menu.ItemDescription>{description}</Menu.ItemDescription>
                </View>
              </Menu.Item>
            ))}
            <Menu.Item variant="danger" onPress={() => setIsConfirmOpen(true)}>
              <Menu.ItemTitle>Remove from project</Menu.ItemTitle>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={`Remove ${member.user.name}?`}
        description="They lose access to this project's messages, and their tokens stop working for it."
        confirmLabel="Remove"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate({ projectId: member.projectId, userId: member.user.id })}
      />
    </>
  );
}
