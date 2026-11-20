import { Button, Dialog } from "heroui-native";
import { View } from "react-native";

import { usePushRegistration } from "@/hooks/use-push-registration";

/**
 * Registers this phone for pushes while signed in, and once explains why the app wants
 * to send notifications before Android's own permission prompt.
 */
export function PushRegistration() {
  const { isAsking, answer } = usePushRegistration();

  return (
    <Dialog isOpen={isAsking} onOpenChange={(open) => !open && void answer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <View className="mb-5 gap-1.5">
            <Dialog.Title>Get notified</Dialog.Title>
            <Dialog.Description>
              Messages from your agents and scripts arrive as notifications, and you can reply right
              from them. Android asks for permission next.
            </Dialog.Description>
          </View>
          <View className="flex-row justify-end gap-3">
            <Button variant="ghost" size="sm" onPress={() => void answer(false)}>
              <Button.Label>Not now</Button.Label>
            </Button>
            <Button size="sm" onPress={() => void answer(true)}>
              <Button.Label>Continue</Button.Label>
            </Button>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
