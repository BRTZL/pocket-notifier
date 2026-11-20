import Constants from "expo-constants";
import { Button, Dialog, Typography, useToast } from "heroui-native";
import { Share, View } from "react-native";

import { CopyButton } from "@/components/copy-button";
import { errorMessage } from "@/lib/errors";

/**
 * In development, the same invite as a link Expo Go opens (`exp://<metro>/--/invite/<code>`),
 * since Expo Go does not handle the app's own scheme. `null` in release builds.
 */
function expoGoInviteUrl(code: string): string | null {
  // biome-ignore lint/correctness/noUndeclaredVariables: `__DEV__` is React Native's build flag.
  const hostUri = __DEV__ ? Constants.expoConfig?.hostUri : undefined;
  return hostUri ? `exp://${hostUri}/--/invite/${code}` : null;
}

function LinkBox({ label, url }: { label: string; url: string }) {
  return (
    <View className="gap-1">
      <Typography type="body-xs" color="muted">
        {label}
      </Typography>
      <View className="bg-surface-secondary rounded-xl p-3">
        <Typography type="body-sm" selectable>
          {url}
        </Typography>
      </View>
    </View>
  );
}

/**
 * The link of a just-created invite, with Share and Copy. Development builds also show a
 * link that opens the invite screen in Expo Go (`exp://…/--/invite/<code>`).
 */
export function InviteLinkDialog({
  invite,
  onDone,
}: {
  invite: { url: string; code: string } | null;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const devUrl = invite ? expoGoInviteUrl(invite.code) : null;

  function share(url: string) {
    Share.share({ message: url }).catch((error: unknown) => {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not share") });
    });
  }

  return (
    <Dialog isOpen={invite !== null} onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          {invite ? (
            <View className="gap-4">
              <View className="gap-1.5">
                <Dialog.Title>Invite ready</Dialog.Title>
                <Dialog.Description>
                  Send this link to the person you are inviting. It works once.
                </Dialog.Description>
              </View>
              <LinkBox label="Invite link" url={invite.url} />
              {devUrl ? <LinkBox label="Expo Go (development)" url={devUrl} /> : null}
              <View className="flex-row gap-3">
                <Button className="flex-1" onPress={() => share(invite.url)}>
                  <Button.Label>Share</Button.Label>
                </Button>
                <View className="flex-1">
                  <CopyButton
                    value={invite.url}
                    variant="secondary"
                    copiedLabel="Link copied"
                    isSensitive
                  />
                </View>
              </View>
              {devUrl ? (
                <CopyButton
                  value={devUrl}
                  variant="secondary"
                  label="Copy Expo Go link"
                  isSensitive
                />
              ) : null}
              <Button variant="ghost" onPress={onDone}>
                <Button.Label>Done</Button.Label>
              </Button>
            </View>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
