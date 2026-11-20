import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Alert,
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  useToast,
} from "heroui-native";
import { useRef, useState } from "react";
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
import { client, orpc } from "@/utils/orpc";

type CreateInviteInput = Parameters<typeof client.invites.create>[0];

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
  // The invite code and link are secrets: they live only in this state for the dialog,
  // never in the mutation cache, and are cleared when the dialog closes.
  const [created, setCreated] = useState<{ url: string; code: string } | null>(null);
  /** Selected grants for topics the user no longer owns, shown before anything is sent. */
  const [dropped, setDropped] = useState<string[]>([]);
  const submitLock = useRef(false);
  const create = useMutation({
    mutationKey: orpc.invites.create.mutationKey(),
    mutationFn: async (input: CreateInviteInput) => {
      const { invite, url, code } = await client.invites.create(input);
      setCreated({ url, code });
      return invite;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() });
    },
    onError: (error) => {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not create the invite") });
    },
  });
  const ownedTopics = topics.data?.filter((topic) => topic.role === "owner") ?? [];

  async function submit() {
    // Synchronous lock: a double tap must not create two invites.
    if (submitLock.current) {
      return;
    }
    submitLock.current = true;
    const release = () => {
      submitLock.current = false;
    };
    const parsed = InviteForm.safeParse({ email, expiresInDays: expiry });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error));
      release();
      return;
    }
    setErrors({});
    // Ownership may have changed since the screen opened: check against fresh data.
    const fresh = await topics.refetch();
    if (fresh.isError || !fresh.data) {
      toast.show({
        variant: "danger",
        label: errorMessage(fresh.error, "Could not load your topics"),
      });
      release();
      return;
    }
    const owned = new Set(fresh.data.filter((topic) => topic.role === "owner").map((t) => t.id));
    const stale = Object.keys(grants).filter((topicId) => !owned.has(topicId));
    if (stale.length > 0) {
      setDropped(
        stale.map((topicId) => fresh.data.find((topic) => topic.id === topicId)?.name ?? "a topic"),
      );
      release();
      return;
    }
    create.mutate(
      {
        email: parsed.data.email,
        expiresInDays: parsed.data.expiresInDays ?? 7,
        grants: Object.entries(grants).map(([topicId, role]) => ({ topicId, role })),
      },
      { onSettled: release },
    );
  }

  /** Re-selection after a warning: drop the grants for topics that are no longer owned. */
  function removeDropped() {
    const owned = new Set(ownedTopics.map((topic) => topic.id));
    setGrants(Object.fromEntries(Object.entries(grants).filter(([id]) => owned.has(id))));
    setDropped([]);
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
          variant="secondary"
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
        <Input
          variant="secondary"
          value={expiry}
          onChangeText={setExpiry}
          keyboardType="number-pad"
          maxLength={2}
        />
        {errors.expiresInDays ? null : <Description>1–30 days.</Description>}
        <FieldError>{errors.expiresInDays}</FieldError>
      </TextField>

      {dropped.length > 0 ? (
        <View className="gap-2">
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>You no longer own {dropped.join(", ")}</Alert.Title>
              <Alert.Description>
                The invite can't include {dropped.length === 1 ? "it" : "them"}. Remove{" "}
                {dropped.length === 1 ? "it" : "them"} and check the topics again before creating.
              </Alert.Description>
            </Alert.Content>
          </Alert>
          <Button variant="secondary" onPress={removeDropped}>
            <Button.Label>Remove and review</Button.Label>
          </Button>
        </View>
      ) : null}

      <Button onPress={() => void submit()} isDisabled={create.isPending || !topics.isSuccess}>
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
