import * as Clipboard from "expo-clipboard";
import { Button, useToast } from "heroui-native";

/**
 * Copies `value` to the clipboard; the toast never repeats the value itself. `isSensitive`
 * hides it from Android's clipboard preview and keyboards, and keeps it off iOS Universal
 * Clipboard: use it for tokens and invite links.
 */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "primary",
  isSensitive = false,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary";
  isSensitive?: boolean;
}) {
  const { toast } = useToast();
  return (
    <Button
      variant={variant}
      onPress={() => {
        Clipboard.setStringAsync(
          value,
          isSensitive ? { android: { isSensitive: true }, ios: { localOnly: true } } : undefined,
        )
          .then(() => toast.show({ variant: "success", label: copiedLabel }))
          .catch(() => toast.show({ variant: "danger", label: "Could not copy" }));
      }}
    >
      <Button.Label>{label}</Button.Label>
    </Button>
  );
}
