import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import { Button, Card, ListGroup, Separator, Spinner, useToast } from "heroui-native";
import { Fragment, useState } from "react";
import { ScrollView, View } from "react-native";

import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";

import { ENV } from "@/src/env";

const LINKS: { title: string; description: string; href: Href }[] = [
  { title: "Access tokens", description: "Let scripts and agents publish", href: "/tokens" },
  { title: "Invites", description: "Bring people onto this server", href: "/invites" },
  { title: "Devices", description: "Phones that get your pushes", href: "/devices" },
];

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
      }
      // Signing out unmounts the tabs and with them this user's query cache.
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
            <UserAvatar
              user={{ id: user.id, name: user.name, email: user.email, image: user.image ?? null }}
              size="lg"
            />
            <View className="flex-1 gap-0.5">
              <Card.Title>{user.name}</Card.Title>
              <Card.Description>{user.email}</Card.Description>
            </View>
          </Card.Body>
        </Card>
      ) : null}

      <ListGroup>
        {LINKS.map((link, index) => (
          <Fragment key={link.title}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <ListGroup.Item
              onPress={() => router.push(link.href)}
              className="active:bg-surface-secondary"
              accessibilityRole="button"
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{link.title}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{link.description}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
          </Fragment>
        ))}
      </ListGroup>

      <ListGroup>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>App version</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <ListGroup.ItemDescription>
              {Constants.expoConfig?.version ?? "unknown"}
            </ListGroup.ItemDescription>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
        <Separator className="mx-4" />
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Server</ListGroup.ItemTitle>
            <ListGroup.ItemDescription selectable>
              {ENV.EXPO_PUBLIC_SERVER_URL}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
      </ListGroup>

      <Button variant="danger-soft" onPress={() => void signOut()} isDisabled={isSigningOut}>
        {isSigningOut ? <Spinner size="sm" /> : <Button.Label>Sign out</Button.Label>}
      </Button>
    </ScrollView>
  );
}
