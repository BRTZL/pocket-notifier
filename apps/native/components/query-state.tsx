import { Alert, Button, Spinner, Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { errorMessage } from "@/lib/errors";

/** Centered spinner for a screen whose first load is still running. */
export function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center p-6">
      <Spinner size="lg" />
    </View>
  );
}

/** Inline error with a retry button for a failed query. */
export function ErrorState({
  error,
  title = "Could not load",
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <View className="gap-3 p-4">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{errorMessage(error)}</Alert.Description>
        </Alert.Content>
      </Alert>
      {onRetry ? (
        <Button variant="secondary" onPress={onRetry}>
          <Button.Label>Try again</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

/** Empty list placeholder. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View className="items-center gap-2 px-8 py-16">
      <Typography type="h5" align="center">
        {title}
      </Typography>
      {children ? (
        <Typography color="muted" align="center">
          {children}
        </Typography>
      ) : null}
    </View>
  );
}
