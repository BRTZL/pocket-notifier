import { Alert, Button, Spinner, Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { Mascot, type MascotPose } from "@/components/mascot";
import { errorMessage } from "@/lib/errors";

/**
 * A screen whose first load is still running and has nothing to show yet: the mascot
 * thinking above a spinner. Inline loading (a list footer, a button) keeps a bare spinner.
 */
export function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6">
      <Mascot pose="thinking" size={140} />
      <Spinner size="lg" />
    </View>
  );
}

/**
 * Error for a failed query with a retry button. Full screen with the mascot by default;
 * `inline` for a section of a screen that has other content.
 */
export function ErrorState({
  error,
  title = "Could not load",
  onRetry,
  inline = false,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  inline?: boolean;
}) {
  return (
    <View className={inline ? "gap-3" : "flex-1 items-center justify-center gap-4 p-6"}>
      {inline ? null : <Mascot pose="error" size={150} />}
      <Alert status="danger" className="self-stretch">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{errorMessage(error)}</Alert.Description>
        </Alert.Content>
      </Alert>
      {onRetry ? (
        <Button variant="secondary" className="self-stretch" onPress={onRetry}>
          <Button.Label>Try again</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

/** Empty list placeholder, optionally with a mascot pose above the title. */
export function EmptyState({
  title,
  pose,
  children,
}: {
  title: string;
  pose?: MascotPose;
  children?: ReactNode;
}) {
  return (
    <View className="items-center gap-2 px-8 py-12">
      {pose ? (
        <View className="pb-2">
          <Mascot pose={pose} size={160} />
        </View>
      ) : null}
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

/**
 * Shown above rows that are already on screen when a refresh or the next page fails;
 * "Try again" repeats the operation that failed.
 */
export function LoadErrorBanner({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-2 px-4 pb-3">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert.Content>
      </Alert>
      <Button size="sm" variant="secondary" onPress={onRetry}>
        <Button.Label>Try again</Button.Label>
      </Button>
    </View>
  );
}
