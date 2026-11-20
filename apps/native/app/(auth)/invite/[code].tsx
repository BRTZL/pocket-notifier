import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Alert,
  Button,
  Card,
  Chip,
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
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { orpc } from "@/utils/orpc";

const SignUpInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Keep it under 80 characters"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
});

type Field = keyof z.infer<typeof SignUpInput>;
type FieldErrors = Partial<Record<Field, string>>;

function InvitePreviewCard({ code }: { code: string }) {
  const preview = useQuery({
    ...orpc.invites.preview.queryOptions({ input: { code } }),
    retry: false,
  });

  if (preview.isPending) {
    return (
      <View className="items-center py-6">
        <Spinner />
      </View>
    );
  }
  if (preview.isError) {
    const notFound = hasErrorCode(preview.error, "NOT_FOUND");
    return (
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{notFound ? "Invite not found" : "Could not load the invite"}</Alert.Title>
          <Alert.Description>
            {notFound
              ? "It may have expired, been revoked or already used. Ask for a new link."
              : errorMessage(preview.error)}
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const { invitedBy, topics, email } = preview.data;
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

export default function InviteSignUpScreen() {
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const { toast } = useToast();
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setField(field: Field) {
    return (text: string) => setValues((current) => ({ ...current, [field]: text }));
  }

  async function submit() {
    const parsed = SignUpInput.safeParse(values);
    if (!parsed.success) {
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
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-6"
      keyboardShouldPersistTaps="handled"
    >
      <InvitePreviewCard code={code} />

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
    </KeyboardAwareScrollView>
  );
}
