import type { Device } from "@notifier/contract/device";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { KeyboardAvoidingView, View } from "react-native";

import { errorMessage } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** Renames a device; mount with `key={device.id}` so the field starts from its name. */
export function RenameDeviceDialog({
  device,
  onClose,
}: {
  device: Device | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(device?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const rename = useMutation(
    orpc.devices.rename.mutationOptions({
      onSuccess: async () => {
        onClose();
        await queryClient.invalidateQueries({ queryKey: orpc.devices.list.key() });
      },
      onError: (failure) => {
        toast.show({ variant: "danger", label: errorMessage(failure, "Could not rename") });
      },
    }),
  );

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      setError("Use 1–80 characters");
      return;
    }
    if (device) {
      rename.mutate({ id: device.id, name: trimmed });
    }
  }

  return (
    <Dialog isOpen={device !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <KeyboardAvoidingView behavior="padding">
          <Dialog.Content>
            <View className="gap-4">
              <Dialog.Title>Rename device</Dialog.Title>
              <TextField isInvalid={error !== null}>
                <Label>Name</Label>
                <Input value={name} onChangeText={setName} maxLength={80} autoFocus />
                <FieldError>{error}</FieldError>
              </TextField>
              <View className="flex-row justify-end gap-3">
                <Button variant="ghost" size="sm" onPress={onClose}>
                  <Button.Label>Cancel</Button.Label>
                </Button>
                <Button size="sm" onPress={submit} isDisabled={rename.isPending}>
                  {rename.isPending ? (
                    <Spinner size="sm" color="default" />
                  ) : (
                    <Button.Label>Save</Button.Label>
                  )}
                </Button>
              </View>
            </View>
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}
