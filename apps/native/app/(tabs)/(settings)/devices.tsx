import type { Device } from "@notifier/contract/device";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { RenameDeviceDialog } from "@/components/rename-device-dialog";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const PLATFORM_NAMES = { android: "Android", ios: "iOS" } as const;

function DeviceCard({
  device,
  onRename,
  onRemove,
}: {
  device: Device;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <Card.Body className="gap-2">
        <Card.Title numberOfLines={1}>{device.name}</Card.Title>
        <Typography type="body-sm" color="muted">
          {PLATFORM_NAMES[device.platform]}
          {device.appVersion ? ` · app ${device.appVersion}` : ""} · seen{" "}
          {relativeTime(device.lastSeenAt)} ago
        </Typography>
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" onPress={onRename}>
            <Button.Label>Rename</Button.Label>
          </Button>
          <Button size="sm" variant="danger-soft" onPress={onRemove}>
            <Button.Label>Remove</Button.Label>
          </Button>
        </View>
      </Card.Body>
    </Card>
  );
}

export default function DevicesScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const devices = useQuery(orpc.devices.list.queryOptions());
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);
  useRefreshOnFocus(devices.refetch);
  const remove = useMutation(
    orpc.devices.remove.mutationOptions({
      onSuccess: async () => {
        setRemoving(null);
        await queryClient.invalidateQueries({ queryKey: orpc.devices.list.key() });
      },
      onError: (error) => {
        setRemoving(null);
        toast.show({
          variant: "danger",
          label: errorMessage(error, "Could not remove the device"),
        });
      },
    }),
  );

  function renderContent() {
    if (devices.isPending) {
      return <LoadingState />;
    }
    if (devices.isError) {
      return <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />;
    }
    if (devices.data.length === 0) {
      return (
        <EmptyState title="No devices yet" pose="thinking">
          Each phone you sign in on with the notifier app shows up here, so you can rename or remove
          it.
        </EmptyState>
      );
    }
    return devices.data.map((device) => (
      <DeviceCard
        key={device.id}
        device={device}
        onRename={() => setRenaming(device)}
        onRemove={() => setRemoving(device)}
      />
    ));
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="grow gap-3 p-4"
      contentInsetAdjustmentBehavior="automatic"
    >
      {renderContent()}
      <RenameDeviceDialog
        key={renaming?.id ?? "none"}
        device={renaming}
        onClose={() => setRenaming(null)}
      />
      <ConfirmDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "device"}?`}
        description="It stops getting push notifications until the app registers it again."
        confirmLabel="Remove"
        isPending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
      />
    </ScrollView>
  );
}
