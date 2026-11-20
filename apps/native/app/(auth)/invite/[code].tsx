import type { InvitePreview } from "@notifier/contract/invite";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Button, Chip, Typography } from "heroui-native";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { z } from "zod";
import { HeroArt } from "@/components/hero-art";
import { InviteSignUpForm } from "@/components/invite-sign-up-form";
import { EmptyState, LoadingState } from "@/components/query-state";
import { StackHeader } from "@/components/screen-header";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { parseInviteCode } from "@/lib/invite";
import { orpc } from "@/utils/orpc";

/** Shown for a malformed code or an invite the server does not know: no sign-up form. */
function InvalidInvite() {
  return (
    <View className="bg-background flex-1 justify-center gap-4 p-6">
      <EmptyState title="Invalid invite link" pose="error">
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

function InviteHeadline({ preview }: { preview: z.infer<typeof InvitePreview> }) {
  const { invitedBy, projects, email } = preview;
  return (
    <View className="gap-2 px-1">
      <Typography
        accessibilityRole="header"
        className="font-heavy text-[30px] leading-[34px] tracking-[-0.9px]"
      >
        {invitedBy} invited you.
      </Typography>
      <Typography className="text-muted text-[16px] leading-[22px]">
        {email ? `This invite is for ${email}.` : "Create your account to join."}
      </Typography>
      {projects.length > 0 ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {projects.map((project) => (
            <Chip key={project} size="sm" variant="soft" color="accent">
              <Chip.Label>{project}</Chip.Label>
            </Chip>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function InviteSignUp({ code }: { code: string }) {
  const preview = useQuery({
    ...orpc.invites.preview.queryOptions({ input: { code } }),
    retry: false,
  });

  if (preview.isPending) {
    return (
      <View className="bg-background flex-1">
        <LoadingState />
      </View>
    );
  }
  if (preview.isError && hasErrorCode(preview.error, "NOT_FOUND")) {
    return <InvalidInvite />;
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-[22px] px-5 pt-4 pb-6"
      keyboardShouldPersistTaps="handled"
    >
      <HeroArt pose="invite" height={220} />
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
        <InviteHeadline preview={preview.data} />
      )}
      <InviteSignUpForm code={code} />
    </KeyboardAwareScrollView>
  );
}

export default function InviteSignUpScreen() {
  const { code: rawCode = "" } = useLocalSearchParams<{ code: string }>();
  const code = parseInviteCode(rawCode);
  return (
    <View className="bg-background flex-1">
      <StackHeader title="Join Pocket Notifier" />
      {code === null ? <InvalidInvite /> : <InviteSignUp code={code} />}
    </View>
  );
}
