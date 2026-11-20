import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { FilledField } from "@/components/filled-field";
import { HeroArt } from "@/components/hero-art";
import { StackHeader } from "@/components/screen-header";
import { inviteCodeFromInput } from "@/lib/invite";

export default function InviteEntryScreen() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const code = inviteCodeFromInput(value);
    if (code === null) {
      setError("Paste the invite link or its 24-character code");
      return;
    }
    setError(null);
    router.push({ pathname: "/invite/[code]", params: { code } });
  }

  return (
    <View className="bg-background flex-1">
      <StackHeader title="Invite" />
      <KeyboardAwareScrollView
        className="bg-background"
        contentContainerClassName="px-5 pt-4 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        <HeroArt pose="invite" height={260} />
        <View className="mt-[26px] gap-2 px-1">
          <Typography
            accessibilityRole="header"
            className="font-heavy text-[30px] leading-[34px] tracking-[-0.9px]"
          >
            Join with an invite.
          </Typography>
          <Typography className="text-muted text-[16px] leading-[22px]">
            Paste the link someone on this server sent you. The code is its last part.
          </Typography>
        </View>
        <View className="mt-[22px] gap-2.5">
          <FilledField
            label="Invite link or code"
            isRequired
            error={error}
            value={value}
            onChangeText={setValue}
            placeholder="https://…/invite/… or the code"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Button className="mt-2 h-[54px] rounded-full" onPress={submit}>
            <Button.Label className="font-heavy text-[17px]">Continue</Button.Label>
          </Button>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
