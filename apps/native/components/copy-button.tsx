import * as Clipboard from "expo-clipboard";
import { Button, useToast } from "heroui-native";

/** Copies `value` to the clipboard; the toast never repeats the value itself. */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "primary",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const { toast } = useToast();
  return (
    <Button
      variant={variant}
      onPress={() => {
        Clipboard.setStringAsync(value)
          .then(() => toast.show({ variant: "success", label: copiedLabel }))
          .catch(() => toast.show({ variant: "danger", label: "Could not copy" }));
      }}
    >
      <Button.Label>{label}</Button.Label>
    </Button>
  );
}
