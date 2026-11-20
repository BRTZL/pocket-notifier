import { router, Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { View } from "react-native";

import { Mascot } from "@/components/mascot";
import { authClient } from "@/lib/auth-client";

export default function NotFoundScreen() {
  const { data: session } = authClient.useSession();
  // `/` only exists while signed in; signed out, home is the sign-in screen.
  const home = session ? "/" : "/sign-in";
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View className="bg-background flex-1 items-center justify-center gap-2 p-6">
        <Mascot pose="error" size={150} />
        <Typography className="font-heavy text-[22px] leading-7">Page not found</Typography>
        <Typography className="text-muted text-center text-[15px] leading-[21px]">
          This link does not lead anywhere in the app.
        </Typography>
        <Button className="mt-4 self-stretch" onPress={() => router.replace(home)}>
          <Button.Label>Go home</Button.Label>
        </Button>
      </View>
    </>
  );
}
