import { router } from "expo-router";
import {
  Button,
  FieldError,
  Input,
  type InputRef,
  Label,
  Spinner,
  TextField,
  Typography,
  useToast,
} from "heroui-native";
import { useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";

const SignInInput = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FieldErrors = Partial<Record<"email" | "password", string>>;

export default function SignInScreen() {
  const { toast } = useToast();
  const passwordRef = useRef<InputRef>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    const parsed = SignInInput.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.email(parsed.data);
      if (error) {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not sign in") });
      }
      // On success the session changes and the root layout switches to the tabs.
    } catch (error) {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not sign in") });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <KeyboardAwareScrollView
        contentContainerClassName="grow justify-center gap-6 p-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Typography type="h2">notifier</Typography>
          <Typography color="muted">Sign in to see your notifications.</Typography>
        </View>

        <View className="gap-4">
          <TextField isRequired isInvalid={Boolean(errors.email)}>
            <Label>Email</Label>
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <FieldError>{errors.email}</FieldError>
          </TextField>

          <TextField isRequired isInvalid={Boolean(errors.password)}>
            <Label>Password</Label>
            <Input
              ref={passwordRef}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            <FieldError>{errors.password}</FieldError>
          </TextField>

          <Button onPress={() => void submit()} isDisabled={isSubmitting}>
            {isSubmitting ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Button.Label>Sign in</Button.Label>
            )}
          </Button>
        </View>

        <Button variant="ghost" onPress={() => router.push("/invite")}>
          <Button.Label>I have an invite</Button.Label>
        </Button>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
