import type { AccessToken } from "@notifier/contract/token";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { Button, Card, Chip, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { errorMessage } from "@/lib/errors";
import { scopeSummary, tokenUsage } from "@/lib/token";
import { orpc } from "@/utils/orpc";

function TokenCard({ token, onRevoke }: { token: AccessToken; onRevoke: () => void }) {
  return (
    <Card>
      <Card.Body className="gap-2">
        <View className="flex-row items-center gap-2">
          <Card.Title className="flex-1" numberOfLines={1}>
            {token.name}
          </Card.Title>
          <Chip size="sm" variant="soft" color="default">
            <Chip.Label>{token.start}…</Chip.Label>
          </Chip>
        </View>
        <Typography type="body-sm">{scopeSummary(token.scope)}</Typography>
        <Typography type="body-xs" color="muted">
          {tokenUsage(token)}
        </Typography>
        <Button size="sm" variant="danger-soft" className="self-start" onPress={onRevoke}>
          <Button.Label>Revoke</Button.Label>
        </Button>
      </Card.Body>
    </Card>
  );
}

export default function TokensScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tokens = useQuery(orpc.tokens.list.queryOptions());
  const [revoking, setRevoking] = useState<AccessToken | null>(null);
  useRefreshOnFocus(tokens.refetch);
  const revoke = useMutation(
    orpc.tokens.revoke.mutationOptions({
      onSuccess: async () => {
        toast.show({ variant: "success", label: `Revoked ${revoking?.name ?? "the token"}` });
        setRevoking(null);
        await queryClient.invalidateQueries({ queryKey: orpc.tokens.list.key() });
      },
      onError: (error) => {
        setRevoking(null);
        toast.show({ variant: "danger", label: errorMessage(error, "Could not revoke the token") });
      },
    }),
  );

  function renderContent() {
    if (tokens.isPending) {
      return <LoadingState />;
    }
    if (tokens.isError) {
      return <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />;
    }
    if (tokens.data.length === 0) {
      return (
        <EmptyState title="No access tokens">
          Create a token so a script, CI job or coding agent can publish to your topics.
        </EmptyState>
      );
    }
    return tokens.data.map((token) => (
      <TokenCard key={token.id} token={token} onRevoke={() => setRevoking(token)} />
    ));
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="grow gap-3 p-4"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button size="sm" variant="ghost" onPress={() => router.push("/tokens/new")}>
              <Button.Label>New token</Button.Label>
            </Button>
          ),
        }}
      />
      {renderContent()}
      <ConfirmDialog
        isOpen={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "token"}?`}
        description="Anything using this token can no longer publish. This cannot be undone."
        confirmLabel="Revoke"
        isPending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id })}
      />
    </ScrollView>
  );
}
