import type { InboxMessage } from "@notifier/contract/message";
import { RESPONSE_TEXT_MAX } from "@notifier/contract/response";
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
import { responseTo, useSendResponse } from "@/hooks/use-send-response";
import { errorMessage } from "@/lib/errors";
import { runHttpAction } from "@/lib/http-action";

export type MessageAction = InboxMessage["actions"][number];
export type ReplyAction = Extract<MessageAction, { type: "reply" }>;
export type HttpAction = Extract<MessageAction, { type: "http" }>;
export type ViewAction = Extract<MessageAction, { type: "view" }>;

function DoneChip({ label }: { label: string }) {
  return (
    <Chip size="lg" variant="soft" color="success" className="self-start">
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function AckButton({ messageId, action }: { messageId: string; action: ReplyAction }) {
  const { send, isSending } = useSendResponse();
  return (
    <Button
      variant="primary"
      onPress={() => void send({ messageId, actionKey: action.key })}
      isDisabled={isSending}
    >
      {isSending ? (
        <Spinner size="sm" color="default" />
      ) : (
        <Button.Label>{action.label}</Button.Label>
      )}
    </Button>
  );
}

function InlineReply({ messageId, action }: { messageId: string; action: ReplyAction }) {
  const { send, isSending } = useSendResponse();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError("Write a reply first");
      return;
    }
    setError(null);
    void send({ messageId, actionKey: action.key, text: trimmed });
  }

  return (
    <View className="gap-3">
      <TextField isInvalid={error !== null} isDisabled={isSending}>
        <Label>{action.label}</Label>
        <TextArea
          variant="secondary"
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

/** An `http` action: the locked-down request from the phone, with a toast for the outcome. */
export function HttpButton({
  action,
  size = "md",
  variant = "secondary",
}: {
  action: HttpAction;
  size?: "sm" | "md";
  variant?: "secondary" | "outline";
}) {
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
    <Button size={size} variant={variant} onPress={() => void run()} isDisabled={isRunning}>
      {isRunning ? <Spinner size="sm" /> : <Button.Label>{action.label}</Button.Label>}
    </Button>
  );
}

/** A `view` action: opens its link through the link-safety check. */
export function ViewButton({
  action,
  size = "md",
  variant = "secondary",
}: {
  action: ViewAction;
  size?: "sm" | "md";
  variant?: "secondary" | "outline";
}) {
  const openLink = useOpenLink();
  return (
    <Button size={size} variant={variant} onPress={() => openLink(action.url)}>
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
          case "reply": {
            const answer = responseTo(message, action.key);
            if (answer) {
              return (
                <View key={action.key} className="gap-2">
                  <DoneChip label={`${action.label} · sent`} />
                  {answer.text ? <Typography color="muted">“{answer.text}”</Typography> : null}
                </View>
              );
            }
            return action.input ? (
              <InlineReply key={action.key} messageId={message.id} action={action} />
            ) : (
              <AckButton key={action.key} messageId={message.id} action={action} />
            );
          }
          default:
            return null;
        }
      })}
    </View>
  );
}
