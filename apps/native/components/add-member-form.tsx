import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { z } from "zod";

import { type GrantableRole, RoleSelect } from "@/components/role-select";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

const Email = z.string().trim().min(1, "Email is required").email("Enter a valid email address");

/** Owner-only: adds an existing user by email; unknown emails get a way to the invite flow. */
export function AddMemberForm({ topicId }: { topicId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantableRole>("subscriber");
  const [error, setError] = useState<string | null>(null);
  const [unknownEmail, setUnknownEmail] = useState<string | null>(null);
  const add = useMutation(
    orpc.members.add.mutationOptions({
      onSuccess: async (member) => {
        setEmail("");
        await queryClient.invalidateQueries({
          queryKey: orpc.members.list.queryKey({ input: { topicId } }),
        });
        toast.show({ variant: "success", label: `Added ${member.user.name} as ${member.role}` });
      },
      onError: (failure, variables) => {
        if (hasErrorCode(failure, "NOT_FOUND")) {
          setUnknownEmail(variables.email);
          return;
        }
        if (hasErrorCode(failure, "CONFLICT")) {
          setError("Already a member of this topic");
          return;
        }
        toast.show({ variant: "danger", label: errorMessage(failure, "Could not add the member") });
      },
    }),
  );

  function submit() {
    if (add.isPending) {
      return;
    }
    setUnknownEmail(null);
    const parsed = Email.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setError(null);
    add.mutate({ topicId, email: parsed.data, role });
  }

  return (
    <View className="gap-3">
      <TextField isInvalid={error !== null} isDisabled={add.isPending}>
        <Label>Add a member</Label>
        <Input
          variant="secondary"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError(null);
            setUnknownEmail(null);
          }}
          placeholder="their@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <FieldError>{error}</FieldError>
      </TextField>
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <RoleSelect value={role} onChange={setRole} isDisabled={add.isPending} />
        </View>
        <Button onPress={submit} isDisabled={add.isPending}>
          {add.isPending ? <Spinner size="sm" color="default" /> : <Button.Label>Add</Button.Label>}
        </Button>
      </View>
      {unknownEmail ? (
        <View className="gap-2">
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>No user with that email</Alert.Title>
              <Alert.Description>Send an invite instead.</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: "/invites/new",
                params: { email: unknownEmail, topicId, role },
              })
            }
          >
            <Button.Label>Invite {unknownEmail}</Button.Label>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
