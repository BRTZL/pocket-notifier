import type { MyTopic } from "@notifier/contract/topic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  Button,
  Card,
  ControlField,
  Description,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  Separator,
  Spinner,
  TextField,
  Typography,
  useToast,
} from "heroui-native";
import { Fragment, useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { z } from "zod";

import { ErrorState } from "@/components/query-state";
import { SecretDialog } from "@/components/secret-dialog";
import { daysText } from "@/lib/days";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { client, orpc } from "@/utils/orpc";

type ScopeKind = "all" | "topics";
type CreateTokenInput = Parameters<typeof client.tokens.create>[0];

const TokenForm = z.object({
  name: z.string().trim().min(1, "Name the token").max(80, "Keep it under 80 characters"),
  topics: z.array(z.string()),
  scope: z.enum(["all", "topics"]),
  expiresInDays: daysText({ min: 1, max: 365, optional: true }),
});
type Field = keyof z.infer<typeof TokenForm>;

/** Topics a token may be scoped to: those the user owns or publishes to. */
function publishableTopics(topics: MyTopic[]): MyTopic[] {
  return topics.filter((topic) => topic.role !== "subscriber");
}

function TopicPicker({
  topics,
  selected,
  onToggle,
}: {
  topics: MyTopic[];
  selected: string[];
  onToggle: (name: string, isSelected: boolean) => void;
}) {
  if (topics.length === 0) {
    return <Typography color="muted">You don't own or publish to any topic yet.</Typography>;
  }
  return (
    <Card>
      <Card.Body className="gap-2">
        {topics.map((topic, index) => (
          <Fragment key={topic.id}>
            {index > 0 ? <Separator /> : null}
            <ControlField
              isSelected={selected.includes(topic.name)}
              onSelectedChange={(value) => onToggle(topic.name, value)}
            >
              <View className="flex-1">
                <Label>{topic.displayName ?? topic.name}</Label>
                <Description>
                  {topic.name} · {topic.role}
                </Description>
              </View>
              <ControlField.Indicator variant="checkbox" />
            </ControlField>
          </Fragment>
        ))}
      </Card.Body>
    </Card>
  );
}

export default function NewTokenScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const topics = useQuery(orpc.topics.list.queryOptions());
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ScopeKind>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  // The secret lives only in this state for the dialog, never in the mutation cache, and
  // is cleared when the dialog closes.
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const submitLock = useRef(false);
  const create = useMutation({
    mutationKey: orpc.tokens.create.mutationKey(),
    mutationFn: async (input: CreateTokenInput) => {
      const { token, secret } = await client.tokens.create(input);
      setCreated({ name: token.name, secret });
      return token;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.tokens.list.key() });
    },
    onError: (error) => {
      toast.show({ variant: "danger", label: errorMessage(error, "Could not create the token") });
    },
  });

  function submit() {
    // Synchronous lock: a double tap must not create two tokens.
    if (submitLock.current) {
      return;
    }
    const parsed = TokenForm.safeParse({ name, scope, topics: selected, expiresInDays: expiry });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error));
      return;
    }
    if (scope === "topics" && selected.length === 0) {
      setErrors({ topics: "Pick at least one topic" });
      return;
    }
    setErrors({});
    submitLock.current = true;
    create.mutate(
      {
        name: parsed.data.name,
        scope: scope === "all" ? { kind: "all" } : { kind: "topics", topics: selected },
        expiresInDays: parsed.data.expiresInDays,
      },
      {
        onSettled: () => {
          submitLock.current = false;
        },
      },
    );
  }

  function renderTopics() {
    if (topics.isError) {
      return <ErrorState inline error={topics.error} onRetry={() => void topics.refetch()} />;
    }
    if (topics.isPending) {
      return <Spinner />;
    }
    return (
      <TopicPicker
        topics={publishableTopics(topics.data)}
        selected={selected}
        onToggle={(topicName, isSelected) =>
          setSelected((current) =>
            isSelected ? [...current, topicName] : current.filter((entry) => entry !== topicName),
          )
        }
      />
    );
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-5 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <TextField isRequired isInvalid={Boolean(errors.name)}>
        <Label>Name</Label>
        <Input
          variant="secondary"
          value={name}
          onChangeText={setName}
          placeholder="e.g. laptop agents"
          maxLength={80}
        />
        <FieldError>{errors.name}</FieldError>
      </TextField>

      <View className="gap-2">
        <Label>Can publish to</Label>
        <RadioGroup value={scope} onValueChange={(value) => setScope(value as ScopeKind)}>
          <RadioGroup.Item value="all">
            <View className="flex-1">
              <Label>All my topics</Label>
              <Description>Every topic you own or publish to, including future ones.</Description>
            </View>
            <Radio />
          </RadioGroup.Item>
          <RadioGroup.Item value="topics">
            <View className="flex-1">
              <Label>Only selected topics</Label>
            </View>
            <Radio />
          </RadioGroup.Item>
        </RadioGroup>
      </View>

      {scope === "topics" ? (
        <View className="gap-2">
          {renderTopics()}
          {errors.topics ? (
            <Typography type="body-sm" className="text-danger">
              {errors.topics}
            </Typography>
          ) : null}
        </View>
      ) : null}

      <TextField isInvalid={Boolean(errors.expiresInDays)}>
        <Label>Expires after (days)</Label>
        <Input
          variant="secondary"
          value={expiry}
          onChangeText={setExpiry}
          placeholder="Never"
          keyboardType="number-pad"
          maxLength={3}
        />
        {errors.expiresInDays ? null : (
          <Description>Leave empty for a token that never expires (1–365).</Description>
        )}
        <FieldError>{errors.expiresInDays}</FieldError>
      </TextField>

      <Button onPress={submit} isDisabled={create.isPending}>
        {create.isPending ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label>Create token</Button.Label>
        )}
      </Button>

      <SecretDialog
        name={created?.name ?? ""}
        secret={created?.secret ?? null}
        onDone={() => {
          setCreated(null);
          router.back();
        }}
      />
    </KeyboardAwareScrollView>
  );
}
