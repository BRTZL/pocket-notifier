import type { InvitePreview } from "@notifier/contract/invite";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Button, Card, Chip, Spinner } from "heroui-native";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { z } from "zod";

import { InviteSignUpForm } from "@/components/invite-sign-up-form";
import { EmptyState } from "@/components/query-state";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { parseInviteCode } from "@/lib/invite";
import { orpc } from "@/utils/orpc";

/** Shown for a malformed code or an invite the server does not know: no sign-up form. */
function InvalidInvite() {
  return (
    <View className="bg-background flex-1 justify-center gap-4 p-6">
      <EmptyState title="Invalid invite link">
        This link is not a valid invite, or the invite expired, was revoked or was already used. Ask
        for a new link.
      </EmptyState>
      <Button variant="secondary" onPress={() => router.replace("/invite")}>
        <Button.Label>Enter another invite</Button.Label>
      </Button>
      <Button variant="ghost" onPress={() => router.replace("/sign-in")}>
        <Button.Label>Back to sign in</Button.Label>
      </Button>
    </View>
  );
}

function InvitePreviewCard({ preview }: { preview: z.infer<typeof InvitePreview> }) {
  const { invitedBy, topics, email } = preview;
  return (
    <Card>
      <Card.Body className="gap-3">
        <Card.Title>{invitedBy} invited you</Card.Title>
        <Card.Description>
          {email ? `This invite is for ${email}.` : "Create your account to join."}
        </Card.Description>
        {topics.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {topics.map((topic) => (
              <Chip key={topic} size="sm" variant="soft" color="accent">
                <Chip.Label>{topic}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}
      </Card.Body>
    </Card>
  );
}

function InviteSignUp({ code }: { code: string }) {
  const preview = useQuery({
    ...orpc.invites.preview.queryOptions({ input: { code } }),
    retry: false,
  });

  if (preview.isPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }
  if (preview.isError && hasErrorCode(preview.error, "NOT_FOUND")) {
    return <InvalidInvite />;
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-6"
      keyboardShouldPersistTaps="handled"
    >
      {preview.isError ? (
        // Network or server trouble: the invite may still be fine, and sign-up checks it.
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not load the invite</Alert.Title>
            <Alert.Description>{errorMessage(preview.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <InvitePreviewCard preview={preview.data} />
      )}
      <InviteSignUpForm code={code} />
    </KeyboardAwareScrollView>
  );
}

export default function InviteSignUpScreen() {
  const { code: rawCode = "" } = useLocalSearchParams<{ code: string }>();
  const code = parseInviteCode(rawCode);
  if (code === null) {
    return <InvalidInvite />;
  }
  return <InviteSignUp code={code} />;
}
