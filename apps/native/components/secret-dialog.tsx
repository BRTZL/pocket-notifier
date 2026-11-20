import { Alert, Button, Dialog, Typography } from "heroui-native";
import { View } from "react-native";

import { CopyButton } from "@/components/copy-button";

/** Shows a just-created token secret once, with a copy button; closing it leaves the screen. */
export function SecretDialog({
  name,
  secret,
  onDone,
}: {
  name: string;
  secret: string | null;
  onDone: () => void;
}) {
  return (
    <Dialog isOpen={secret !== null} onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <View className="gap-4">
            <View className="gap-1.5">
              <Dialog.Title>{name} created</Dialog.Title>
              <Dialog.Description>Send it as a Bearer token when publishing.</Dialog.Description>
            </View>
            <View className="bg-surface-secondary rounded-xl p-3">
              <Typography selectable className="font-mono" accessibilityLabel="Token secret">
                {secret}
              </Typography>
            </View>
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Copy it now</Alert.Title>
                <Alert.Description>
                  You won't see this token again. If you lose it, revoke it and create a new one.
                </Alert.Description>
              </Alert.Content>
            </Alert>
            {secret ? (
              <CopyButton value={secret} label="Copy token" copiedLabel="Token copied" />
            ) : null}
            <Button variant="ghost" onPress={onDone}>
              <Button.Label>Done</Button.Label>
            </Button>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
