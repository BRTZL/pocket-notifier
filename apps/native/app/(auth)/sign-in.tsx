import { router } from "expo-router";
import { Button, type InputRef, Spinner, Typography, useToast } from "heroui-native";
import { useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import z from "zod";

import { FilledField } from "@/components/filled-field";
import { HeroArt } from "@/components/hero-art";
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
  const submitLock = useRef(false);

  async function submit() {
    // Synchronous lock: the keyboard's "Go" and the button can both fire before the
    // `isSubmitting` state re-renders.
    if (submitLock.current) {
      return;
    }
    submitLock.current = true;
    const parsed = SignInInput.safeParse({ email, password });
    if (!parsed.success) {
      submitLock.current = false;
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
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <KeyboardAwareScrollView
        contentContainerClassName="grow px-5 pt-3 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        <HeroArt />

        <View className="mt-[26px] gap-2 px-1">
          <Typography
            accessibilityRole="header"
            className="font-heavy text-[30px] leading-[34px] tracking-[-0.9px]"
          >
            Your agents, one chat away.
          </Typography>
          <Typography className="text-muted text-[16px] leading-[22px]">
            Sign in to your notifier server.
          </Typography>
        </View>

        <View className="mt-[22px] gap-2.5">
          <FilledField
            label="Email"
            isRequired
            error={errors.email}
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
          <FilledField
            label="Password"
            isRequired
            error={errors.password}
            inputRef={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />

          <Button
            className="mt-2 h-[54px] rounded-full"
            onPress={() => void submit()}
            isDisabled={isSubmitting}
          >
            {isSubmitting ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Button.Label className="font-heavy text-[17px]">Sign in</Button.Label>
            )}
          </Button>
          <Button
            variant="ghost"
            className="mt-1.5 self-center"
            onPress={() => router.push("/invite")}
          >
            <Button.Label className="text-foreground text-[15.5px] font-bold">
              I have an invite
            </Button.Label>
          </Button>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
