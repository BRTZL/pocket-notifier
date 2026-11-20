import type { InboxMessage } from "@notifier/contract/message";
import { RESPONSE_TEXT_MAX } from "@notifier/contract/response";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Chip,
  FieldError,
  Label,
  Spinner,
  TextArea,
  TextField,
  Typography,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { View } from "react-native";

import { useOpenLink } from "@/hooks/use-open-link";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { runHttpAction } from "@/lib/http-action";
import { orpc } from "@/utils/orpc";

type MessageAction = InboxMessage["actions"][number];
type ReplyAction = Extract<MessageAction, { type: "reply" }>;
type HttpAction = Extract<MessageAction, { type: "http" }>;

/** Sends a `reply` action's response; CONFLICT means it was already answered, which counts as done. */
function useReply(messageId: string, actionKey: string) {
  const [isDone, setIsDone] = useState(false);
  const [wasAlreadyAnswered, setWasAlreadyAnswered] = useState(false);
  const { toast } = useToast();
  const mutation = useMutation(
    orpc.responses.create.mutationOptions({
      onSuccess: () => setIsDone(true),
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) {
          setWasAlreadyAnswered(true);
          setIsDone(true);
          return;
        }
        toast.show({ variant: "danger", label: errorMessage(error, "Could not send the reply") });
      },
    }),
  );
  function send(text?: string) {
    mutation.mutate({ messageId, actionKey, text });
  }
  return { send, isDone, wasAlreadyAnswered, isSending: mutation.isPending };
}

function DoneChip({ label }: { label: string }) {
  return (
    <Chip size="lg" variant="soft" color="success" className="self-start">
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function AckButton({ messageId, action }: { messageId: string; action: ReplyAction }) {
  const { send, isDone, wasAlreadyAnswered, isSending } = useReply(messageId, action.key);
  if (isDone) {
    return <DoneChip label={wasAlreadyAnswered ? "Already answered" : `${action.label} · sent`} />;
  }
  return (
    <Button variant="primary" onPress={() => send()} isDisabled={isSending}>
      {isSending ? (
        <Spinner size="sm" color="default" />
      ) : (
        <Button.Label>{action.label}</Button.Label>
      )}
    </Button>
  );
}

function InlineReply({ messageId, action }: { messageId: string; action: ReplyAction }) {
  const { send, isDone, wasAlreadyAnswered, isSending } = useReply(messageId, action.key);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentText, setSentText] = useState<string | null>(null);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError("Write a reply first");
      return;
    }
    setError(null);
    setSentText(trimmed);
    send(trimmed);
  }

  if (isDone) {
    return (
      <View className="gap-2">
        <DoneChip label={wasAlreadyAnswered ? "Already answered" : `${action.label} · sent`} />
        {sentText && !wasAlreadyAnswered ? (
          <Typography color="muted">“{sentText}”</Typography>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-3">
      <TextField isInvalid={error !== null} isDisabled={isSending}>
        <Label>{action.label}</Label>
        <TextArea
          value={text}
          onChangeText={setText}
          placeholder={action.placeholder ?? "Write a reply"}
          maxLength={RESPONSE_TEXT_MAX}
        />
        <FieldError>{error}</FieldError>
      </TextField>
      {action.quickReplies && action.quickReplies.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {action.quickReplies.map((reply) => (
            <Chip
              key={reply}
              variant="secondary"
              color="accent"
              onPress={() => submit(reply)}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel={`Send “${reply}”`}
            >
              <Chip.Label>{reply}</Chip.Label>
            </Chip>
          ))}
        </View>
      ) : null}
      <Button onPress={() => submit(text)} isDisabled={isSending}>
        {isSending ? <Spinner size="sm" color="default" /> : <Button.Label>Send</Button.Label>}
      </Button>
    </View>
  );
}

function HttpButton({ action }: { action: HttpAction }) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);

  async function run() {
    setIsRunning(true);
    try {
      await runHttpAction(action);
      toast.show({ variant: "success", label: `${action.label}: done` });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: `${action.label} failed`,
        description: errorMessage(error),
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Button variant="secondary" onPress={() => void run()} isDisabled={isRunning}>
      {isRunning ? <Spinner size="sm" /> : <Button.Label>{action.label}</Button.Label>}
    </Button>
  );
}

function ViewButton({ action }: { action: Extract<MessageAction, { type: "view" }> }) {
  const openLink = useOpenLink();
  return (
    <Button variant="secondary" onPress={() => openLink(action.url)}>
      <Button.Label>{action.label}</Button.Label>
    </Button>
  );
}

/** Every action of a message, including those beyond the three a notification can show. */
export function MessageActions({ message }: { message: InboxMessage }) {
  if (message.actions.length === 0) {
    return null;
  }
  return (
    <View className="gap-3">
      {message.actions.map((action) => {
        switch (action.type) {
          case "view":
            return <ViewButton key={action.key} action={action} />;
          case "http":
            return <HttpButton key={action.key} action={action} />;
          case "reply":
            return action.input ? (
              <InlineReply key={action.key} messageId={message.id} action={action} />
            ) : (
              <AckButton key={action.key} messageId={message.id} action={action} />
            );
          default:
            return null;
        }
      })}
    </View>
  );
}
