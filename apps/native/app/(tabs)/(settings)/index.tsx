import { avatarColor, avatarInitials } from "@notifier/contract/avatar";
import { Avatar, Button, Card, Spinner, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";
import { queryClient } from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const user = session?.user;

  async function signOut() {
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not sign out") });
        return;
      }
      // The root layout also clears on the user change; clearing here drops data at once.
      queryClient.clear();
    } catch (error) {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not sign out") });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="gap-4 p-4"
      contentInsetAdjustmentBehavior="automatic"
    >
      {user ? (
        <Card>
          <Card.Body className="flex-row items-center gap-4">
            <Avatar size="lg" background={null} alt={user.name}>
              {user.image ? <Avatar.Image source={{ uri: user.image }} /> : null}
              <Avatar.Fallback
                styles={{ container: { backgroundColor: avatarColor(user.id) } }}
                classNames={{ text: "font-semibold text-white" }}
              >
                {avatarInitials(user.name || user.email)}
              </Avatar.Fallback>
            </Avatar>
            <View className="flex-1 gap-0.5">
              <Card.Title>{user.name}</Card.Title>
              <Card.Description>{user.email}</Card.Description>
            </View>
          </Card.Body>
        </Card>
      ) : null}

      <Button variant="danger-soft" onPress={() => void signOut()} isDisabled={isSigningOut}>
        {isSigningOut ? <Spinner size="sm" /> : <Button.Label>Sign out</Button.Label>}
      </Button>
    </ScrollView>
  );
}
