import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { z } from "zod";
import { GrantPicker, type Grants } from "@/components/grant-picker";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { ErrorState } from "@/components/query-state";
import type { GrantableRole } from "@/components/role-select";
import { daysText } from "@/lib/days";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { orpc } from "@/utils/orpc";

const InviteForm = z.object({
  email: z
    .string()
    .trim()
    .refine((text) => text.length === 0 || z.email().safeParse(text).success, "Enter a valid email")
    .transform((text) => (text.length > 0 ? text : undefined)),
  expiresInDays: daysText({ min: 1, max: 30, optional: false }),
});
type Field = keyof z.infer<typeof InviteForm>;

/** Prefill from "add member" when the email had no account: lock it and grant that topic. */
function initialGrants(topicId?: string, role?: string): Grants {
  if (!topicId) {
    return {};
  }
  return { [topicId]: role === "publisher" ? "publisher" : ("subscriber" as GrantableRole) };
}

export default function NewInviteScreen() {
  const params = useLocalSearchParams<{ email?: string; topicId?: string; role?: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const topics = useQuery(orpc.topics.list.queryOptions());
  const [email, setEmail] = useState(params.email ?? "");
  const [expiry, setExpiry] = useState("7");
  const [grants, setGrants] = useState<Grants>(() => initialGrants(params.topicId, params.role));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [created, setCreated] = useState<{ url: string; code: string } | null>(null);
  const create = useMutation(
    orpc.invites.create.mutationOptions({
      onSuccess: async ({ url, code }) => {
        setCreated({ url, code });
        await queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() });
      },
      onError: (error) => {
        toast.show({
          variant: "danger",
          label: errorMessage(error, "Could not create the invite"),
        });
      },
    }),
  );
  const ownedTopics = topics.data?.filter((topic) => topic.role === "owner") ?? [];

  function submit() {
    if (create.isPending) {
      return;
    }
    const parsed = InviteForm.safeParse({ email, expiresInDays: expiry });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error));
      return;
    }
    setErrors({});
    create.mutate({
      email: parsed.data.email,
      expiresInDays: parsed.data.expiresInDays ?? 7,
      // Only topics still owned: a stale prefill must not fail the whole invite.
      grants: ownedTopics
        .filter((topic) => grants[topic.id] !== undefined)
        .map((topic) => ({ topicId: topic.id, role: grants[topic.id] ?? "subscriber" })),
    });
  }

  function renderGrants() {
    if (topics.isError) {
      return <ErrorState inline error={topics.error} onRetry={() => void topics.refetch()} />;
    }
    if (topics.isPending) {
      return <Spinner />;
    }
    return <GrantPicker topics={ownedTopics} grants={grants} onChange={setGrants} />;
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-5 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <TextField isInvalid={Boolean(errors.email)}>
        <Label>Email</Label>
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="Anyone with the link"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {errors.email ? null : (
          <Description>Optional. When set, only this email can accept the invite.</Description>
        )}
        <FieldError>{errors.email}</FieldError>
      </TextField>

      <View className="gap-2">
        <Label>Topics to join</Label>
        {renderGrants()}
      </View>

      <TextField isRequired isInvalid={Boolean(errors.expiresInDays)}>
        <Label>Expires after (days)</Label>
        <Input value={expiry} onChangeText={setExpiry} keyboardType="number-pad" maxLength={2} />
        {errors.expiresInDays ? null : <Description>1–30 days.</Description>}
        <FieldError>{errors.expiresInDays}</FieldError>
      </TextField>

      <Button onPress={submit} isDisabled={create.isPending}>
        {create.isPending ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label>Create invite</Button.Label>
        )}
      </Button>

      <InviteLinkDialog
        invite={created}
        onDone={() => {
          setCreated(null);
          router.back();
        }}
      />
    </KeyboardAwareScrollView>
  );
}
