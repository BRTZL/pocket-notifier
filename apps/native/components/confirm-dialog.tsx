import { Button, Dialog, Spinner } from "heroui-native";
import { View } from "react-native";

/** A yes/no confirmation for a destructive action; stays open while it runs. */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending = false,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
}) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !isPending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <View className="mb-5 gap-1.5">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
          </View>
          <View className="flex-row justify-end gap-3">
            <Button
              variant="ghost"
              size="sm"
              isDisabled={isPending}
              onPress={() => onOpenChange(false)}
            >
              <Button.Label>Cancel</Button.Label>
            </Button>
            <Button variant="danger" size="sm" isDisabled={isPending} onPress={onConfirm}>
              {isPending ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Button.Label>{confirmLabel}</Button.Label>
              )}
            </Button>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
