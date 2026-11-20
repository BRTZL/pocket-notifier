import { router } from "expo-router";
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  TextField,
  Typography,
} from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { Mascot } from "@/components/mascot";
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
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-1">
        <Mascot pose="invite" size={150} />
        <Typography type="h3">Join with an invite</Typography>
        <Typography color="muted" align="center">
          Someone on this notifier server sent you an invite link.
        </Typography>
      </View>
      <TextField isRequired isInvalid={error !== null}>
        <Label>Invite link or code</Label>
        <Input
          value={value}
          onChangeText={setValue}
          placeholder="https://…/invite/… or the code"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Description>The code is the last part of the link.</Description>
        <FieldError>{error}</FieldError>
      </TextField>
      <Button onPress={submit}>
        <Button.Label>Continue</Button.Label>
      </Button>
    </KeyboardAwareScrollView>
  );
}
