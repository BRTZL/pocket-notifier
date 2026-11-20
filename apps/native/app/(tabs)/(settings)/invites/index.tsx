import type { Invite } from "@notifier/contract/invite";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { Button, Card, Chip, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage } from "@/lib/errors";
import { shortDate } from "@/lib/format";
import { type InviteStatus, inviteStatus } from "@/lib/invite-status";
import { orpc } from "@/utils/orpc";

const STATUS_COLORS = {
  open: "accent",
  accepted: "success",
  revoked: "danger",
  expired: "default",
} as const satisfies Record<InviteStatus, string>;

function statusLine(invite: Invite, status: InviteStatus): string {
  switch (status) {
    case "accepted":
      return `Accepted by ${invite.acceptedBy?.name ?? "someone"}${invite.acceptedAt ? ` on ${shortDate(invite.acceptedAt)}` : ""}`;
    case "revoked":
      return `Revoked${invite.revokedAt ? ` on ${shortDate(invite.revokedAt)}` : ""}`;
    case "expired":
      return `Expired on ${shortDate(invite.expiresAt)}`;
    default:
      return `Expires ${shortDate(invite.expiresAt)}`;
  }
}

function InviteCard({
  invite,
  projectNames,
  onRevoke,
}: {
  invite: Invite;
  projectNames: Map<string, string>;
  onRevoke: () => void;
}) {
  const status = inviteStatus(invite);
  const grants = invite.grants
    .map((grant) => `${projectNames.get(grant.projectId) ?? "a project"} (${grant.role})`)
    .join(", ");
  return (
    <Card>
      <Card.Body className="gap-2">
        <View className="flex-row items-center gap-2">
          <Card.Title className="flex-1" numberOfLines={1}>
            {invite.email ?? "Anyone with the link"}
          </Card.Title>
          <Chip size="sm" variant="soft" color={STATUS_COLORS[status]}>
            <Chip.Label>{status}</Chip.Label>
          </Chip>
        </View>
        <Typography type="body-sm">{grants || "No projects"}</Typography>
        <Typography type="body-xs" color="muted">
          Created {shortDate(invite.createdAt)} · {statusLine(invite, status)}
        </Typography>
        {status === "open" ? (
          <Button size="sm" variant="danger-soft" className="self-start" onPress={onRevoke}>
            <Button.Label>Revoke</Button.Label>
          </Button>
        ) : null}
      </Card.Body>
    </Card>
  );
}

export default function InvitesScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invites = useQuery(orpc.invites.list.queryOptions());
  const projects = useQuery(orpc.projects.list.queryOptions());
  const [revoking, setRevoking] = useState<Invite | null>(null);
  useRefreshOnFocus(invites.refetch);
  const projectNames = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const revoke = useMutation(
    orpc.invites.revoke.mutationOptions({
      onSuccess: async () => {
        setRevoking(null);
        toast.show({ variant: "success", label: "Invite revoked" });
        await queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() });
      },
      onError: (error) => {
        setRevoking(null);
        toast.show({
          variant: "danger",
          label: errorMessage(error, "Could not revoke the invite"),
        });
      },
    }),
  );

  function renderContent() {
    if (invites.isPending) {
      return <LoadingState />;
    }
    if (invites.isError) {
      return <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />;
    }
    if (invites.data.length === 0) {
      return (
        <EmptyState title="No invites yet" pose="invite">
          Invite someone to give them an account on this server, optionally with projects.
        </EmptyState>
      );
    }
    return invites.data.map((invite) => (
      <InviteCard
        key={invite.id}
        invite={invite}
        projectNames={projectNames}
        onRevoke={() => setRevoking(invite)}
      />
    ));
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="grow gap-3 p-4"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button size="sm" variant="ghost" onPress={() => router.push("/invites/new")}>
              <Button.Label>New invite</Button.Label>
            </Button>
          ),
        }}
      />
      {renderContent()}
      <ConfirmDialog
        isOpen={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this invite?"
        description="The link stops working. People who already joined keep their account."
        confirmLabel="Revoke"
        isPending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id })}
      />
    </ScrollView>
  );
}
