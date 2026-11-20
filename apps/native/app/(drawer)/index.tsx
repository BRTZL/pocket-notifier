import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Card, Chip, useThemeColor } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";
import { orpc, queryClient } from "@/utils/orpc";

import { ENV } from "../../src/env";

function getStatusLabel(isLoading: boolean, isConnected: boolean) {
  if (isLoading) {
    return "Checking connection...";
  }
  return isConnected ? "Connected to API" : "API Disconnected";
}

function StatusIcon({
  isLoading,
  isConnected,
  colors,
}: {
  isLoading: boolean;
  isConnected: boolean;
  colors: { muted: string; success: string; danger: string };
}) {
  if (isLoading) {
    return <Ionicons name="hourglass-outline" size={20} color={colors.muted} />;
  }
  if (isConnected) {
    return <Ionicons name="checkmark-circle" size={20} color={colors.success} />;
  }
  return <Ionicons name="close-circle" size={20} color={colors.danger} />;
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const healthCheck = useQuery({
    queryKey: ["server-status"],
    queryFn: async () => (await fetch(ENV.EXPO_PUBLIC_SERVER_URL)).text(),
  });
  const me = useQuery({ ...orpc.me.get.queryOptions(), enabled: Boolean(session?.user) });
  const isConnected = healthCheck.data === "OK";
  const { isLoading } = healthCheck;

  const mutedColor = useThemeColor("muted");
  const successColor = useThemeColor("success");
  const dangerColor = useThemeColor("danger");

  return (
    <Container className="p-6">
      <View className="mb-6 py-4">
        <Text className="text-foreground mb-2 text-4xl font-bold">BETTER T STACK</Text>
      </View>

      {session?.user ? (
        <Card variant="secondary" className="mb-6 p-4">
          <Text className="text-foreground mb-2 text-base">
            Welcome, <Text className="font-medium">{session.user.name}</Text>
          </Text>
          <Text className="text-muted mb-4 text-sm">{session.user.email}</Text>
          <Pressable
            className="bg-danger self-start rounded-lg px-4 py-3 active:opacity-70"
            onPress={() => {
              void authClient.signOut();
              void queryClient.invalidateQueries();
            }}
          >
            <Text className="text-foreground font-medium">Sign Out</Text>
          </Pressable>
        </Card>
      ) : null}

      <Card variant="secondary" className="p-6">
        <View className="mb-4 flex-row items-center justify-between">
          <Card.Title>System Status</Card.Title>
          <Chip variant="secondary" color={isConnected ? "success" : "danger"} size="sm">
            <Chip.Label>{isConnected ? "LIVE" : "OFFLINE"}</Chip.Label>
          </Chip>
        </View>

        <Card className="p-4">
          <View className="flex-row items-center">
            <View
              className={`mr-3 h-3 w-3 rounded-full ${isConnected ? "bg-success" : "bg-muted"}`}
            />
            <View className="flex-1">
              <Text className="text-foreground mb-1 font-medium">ORPC Backend</Text>
              <Card.Description>{getStatusLabel(isLoading, isConnected)}</Card.Description>
            </View>
            <StatusIcon
              isLoading={isLoading}
              isConnected={isConnected}
              colors={{ muted: mutedColor, success: successColor, danger: dangerColor }}
            />
          </View>
        </Card>
      </Card>

      <Card variant="secondary" className="mt-6 p-4">
        <Card.Title className="mb-3">Account</Card.Title>
        {me.data ? <Card.Description>Signed in as {me.data.email}</Card.Description> : null}
      </Card>

      {!session?.user && (
        <>
          <SignIn />
          <SignUp />
        </>
      )}
    </Container>
  );
}
