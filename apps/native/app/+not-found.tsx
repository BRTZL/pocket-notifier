import { Link, Stack } from "expo-router";
import { Button, Surface, Typography } from "heroui-native";
import { View } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View className="bg-background flex-1 items-center justify-center p-4">
        <Surface variant="secondary" className="w-full max-w-sm items-center gap-2 rounded-lg p-6">
          <Typography type="h5">Page not found</Typography>
          <Typography color="muted" align="center">
            This link does not lead anywhere in the app.
          </Typography>
          <Link href="/" asChild>
            <Button size="sm" className="mt-2">
              <Button.Label>Go home</Button.Label>
            </Button>
          </Link>
        </Surface>
      </View>
    </>
  );
}
