import { router } from "expo-router";
import {
  Button,
  FieldError,
  Input,
  type InputRef,
  Label,
  Spinner,
  TextField,
  useToast,
} from "heroui-native";
import { useRef, useState } from "react";
import { View } from "react-native";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";

const SignUpInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Keep it under 80 characters"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
});

type Field = keyof z.infer<typeof SignUpInput>;
type FieldErrors = Partial<Record<Field, string>>;

/** Sign-up fields for a validated invite code; `inviteCode` is sent in the body. */
export function InviteSignUpForm({ code }: { code: string }) {
  const { toast } = useToast();
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);

  function setField(field: Field) {
    return (text: string) => setValues((current) => ({ ...current, [field]: text }));
  }

  async function submit() {
    // Synchronous lock: the keyboard's "Go" and the button can both fire before the
    // `isSubmitting` state re-renders.
    if (submitLock.current) {
      return;
    }
    submitLock.current = true;
    const parsed = SignUpInput.safeParse(values);
    if (!parsed.success) {
      submitLock.current = false;
      setFieldErrors(fieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      // `inviteCode` is an extra body field the server reads in its sign-up hook.
      // better-auth's typed `signUp.email` rejects unknown keys only in a fresh object
      // literal (excess property check), so the body is built as a variable first.
      // Everything else (expo cookie storage, session refresh) stays better-auth's own.
      const body = { ...parsed.data, inviteCode: code };
      const { error } = await authClient.signUp.email(body);
      if (error) {
        toast.show({
          variant: "danger",
          label: errorMessage(error, "Could not create the account"),
        });
      }
      // On success the session changes and the root layout switches to the tabs.
    } catch (error) {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not create the account") });
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <View className="gap-4">
      <TextField isRequired isInvalid={Boolean(errors.name)}>
        <Label>Name</Label>
        <Input
          value={values.name}
          onChangeText={setField("name")}
          placeholder="Your name"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <FieldError>{errors.name}</FieldError>
      </TextField>
      <TextField isRequired isInvalid={Boolean(errors.email)}>
        <Label>Email</Label>
        <Input
          ref={emailRef}
          value={values.email}
          onChangeText={setField("email")}
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
          value={values.password}
          onChangeText={setField("password")}
          placeholder="At least 8 characters"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <FieldError>{errors.password}</FieldError>
      </TextField>
      <Button onPress={() => void submit()} isDisabled={isSubmitting}>
        {isSubmitting ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label>Create account</Button.Label>
        )}
      </Button>
      <Button variant="ghost" onPress={() => router.replace("/sign-in")}>
        <Button.Label>I already have an account</Button.Label>
      </Button>
    </View>
  );
}
