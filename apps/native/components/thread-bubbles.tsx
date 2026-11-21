import type { InboxMessage } from "@notifier/contract/message";
import * as Clipboard from "expo-clipboard";
import { Button, cn, PressableFeedback, Spinner, Typography, useToast } from "heroui-native";
import { View } from "react-native";

import { Icon } from "@/components/icon";
import { HttpButton, type ReplyAction, ViewButton } from "@/components/message-actions";
import { MessageAttachment } from "@/components/message-attachment";
import { useOpenLink } from "@/hooks/use-open-link";
import { useSendResponse } from "@/hooks/use-send-response";
import { clockTime } from "@/lib/format";
import { openReplyActions } from "@/lib/thread";

/** Long press anywhere on a bubble copies its text. */
function useCopy() {
  const { toast } = useToast();
  return async (text: string) => {
    await Clipboard.setStringAsync(text);
    toast.show({ label: "Copied" });
  };
}

function messageText(message: InboxMessage): string {
  const text = [message.title, message.body].filter(Boolean).join("\n");
  return text || (message.attachment?.name ?? "");
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <View className="mt-3.5 items-center" accessibilityRole="header">
      <Typography className="text-muted text-[12.5px] leading-4 font-semibold">{label}</Typography>
    </View>
  );
}

/** One quick reply or one-tap answer, as an outlined accent pill. */
function QuickReplyPill({
  label,
  isDisabled,
  onPress,
}: {
  label: string;
  isDisabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="outline"
      onPress={onPress}
      isDisabled={isDisabled}
      className="bg-background border-accent h-[38px] rounded-full border-[1.5px] px-4"
      accessibilityLabel={`Answer “${label}”`}
    >
      <Button.Label className="text-accent-text text-[15px] font-bold">{label}</Button.Label>
    </Button>
  );
}

/** Quick replies of open reply actions: a text action's suggestions, or an ack's label. */
function QuickReplies({ message, actions }: { message: InboxMessage; actions: ReplyAction[] }) {
  const { send, isSending } = useSendResponse();
  const pills = actions.flatMap((action) =>
    action.input
      ? (action.quickReplies ?? []).map((reply) => ({
          key: `${action.key}:${reply}`,
          label: reply,
          send: () => send({ messageId: message.id, actionKey: action.key, text: reply }),
        }))
      : [
          {
            key: action.key,
            label: action.label,
            send: () => send({ messageId: message.id, actionKey: action.key }),
          },
        ],
  );
  if (pills.length === 0) {
    return null;
  }
  return (
    <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
      {pills.map((pill) => (
        <QuickReplyPill
          key={pill.key}
          label={pill.label}
          isDisabled={isSending}
          onPress={() => void pill.send()}
        />
      ))}
      {isSending ? <Spinner size="sm" /> : null}
    </View>
  );
}

/** `view` and `http` actions under a bubble, as small outlined buttons. */
function LinkActions({ message }: { message: InboxMessage }) {
  const actions = message.actions.filter((action) => action.type !== "reply");
  if (actions.length === 0) {
    return null;
  }
  return (
    <View className="mt-1.5 flex-row flex-wrap gap-2">
      {actions.map((action) =>
        action.type === "view" ? (
          <ViewButton key={action.key} action={action} size="sm" variant="outline" />
        ) : action.type === "http" ? (
          <HttpButton key={action.key} action={action} size="sm" variant="outline" />
        ) : null,
      )}
    </View>
  );
}

/** A bubble's title and body. An ask's title is larger; priority 5 gets a danger mark. */
function BubbleText({ message, isAsk }: { message: InboxMessage; isAsk: boolean }) {
  const titleClass = isAsk
    ? "font-heavy text-[17px] leading-[22px] tracking-[-0.17px]"
    : "text-[15.5px] leading-[22px] font-bold";
  return (
    <>
      {message.title ? (
        <View className="flex-row items-start gap-1.5">
          {message.priority === 5 ? (
            <View className="pt-0.5">
              <Icon name="error" size={18} color="danger" />
            </View>
          ) : null}
          <Typography className={cn("shrink", titleClass)}>{message.title}</Typography>
        </View>
      ) : null}
      {message.body ? (
        <Typography
          className={cn(
            "text-[15.5px] leading-[22.5px]",
            message.title ? "text-foreground-secondary mt-[5px]" : "text-foreground",
          )}
        >
          {message.body}
        </Typography>
      ) : null}
    </>
  );
}

/**
 * An agent's message on the left. A message with reply actions is an "ask": a larger
 * title, and its open answers as pills below. Tapping a bubble with a link opens it.
 */
export function MessageBubble({
  message,
  senderLabel,
  isRunEnd,
  continuesRun,
}: {
  message: InboxMessage;
  senderLabel: string | null;
  isRunEnd: boolean;
  continuesRun: boolean;
}) {
  const openLink = useOpenLink();
  const copy = useCopy();
  const isAsk = message.actions.some((action) => action.type === "reply");
  const openActions = openReplyActions(message);
  const { clickUrl } = message;
  const hasMedia = message.attachment?.kind === "image" || message.attachment?.kind === "video";

  return (
    <View className={cn("items-start", continuesRun ? "mt-1" : "mt-3.5")}>
      {senderLabel ? (
        <Typography className="text-muted mb-1 pl-3.5 text-[13px] leading-[18px] font-bold">
          {senderLabel}
        </Typography>
      ) : null}
      <PressableFeedback
        animation={false}
        onPress={clickUrl ? () => openLink(clickUrl) : undefined}
        onLongPress={() => void copy(messageText(message))}
        // Media needs a definite width to fill; text bubbles hug their content.
        className={hasMedia ? "w-[84%]" : "max-w-[84%]"}
        accessibilityRole={clickUrl ? "link" : "text"}
        accessibilityHint={clickUrl ? "Opens the link. Long press to copy." : "Long press to copy."}
      >
        <View
          className={cn(
            "bg-background border-border overflow-hidden rounded-[20px] border",
            isAsk ? "px-4 pt-3.5 pb-[15px]" : "px-4 py-[11px]",
          )}
          // The tail corner points at the sender name.
          style={{ borderTopLeftRadius: 6 }}
        >
          <PressableFeedback.Highlight />
          <BubbleText message={message} isAsk={isAsk} />
          {message.attachment ? (
            <View className={message.title || message.body ? "mt-2.5" : undefined}>
              <MessageAttachment attachment={message.attachment} />
            </View>
          ) : null}
        </View>
      </PressableFeedback>
      {openActions.length > 0 ? <QuickReplies message={message} actions={openActions} /> : null}
      <LinkActions message={message} />
      {isRunEnd ? (
        <Typography className="text-muted mt-1 pl-3.5 text-[12px] leading-4">
          {clockTime(message.createdAt)}
        </Typography>
      ) : null}
    </View>
  );
}

/** One of the user's own replies, on the right in the accent color. */
export function MyBubble({ text, continuesRun }: { text: string; continuesRun: boolean }) {
  const copy = useCopy();
  return (
    <View className={cn("items-end", continuesRun ? "mt-1" : "mt-3.5")}>
      <PressableFeedback
        animation={false}
        onLongPress={() => void copy(text)}
        className="max-w-[84%]"
        accessibilityLabel={`You: ${text}`}
        accessibilityHint="Long press to copy."
      >
        <View
          className="bg-accent overflow-hidden rounded-[20px] px-4 py-[11px]"
          style={{ borderBottomRightRadius: 6 }}
        >
          <PressableFeedback.Highlight />
          <Typography className="text-accent-foreground text-[15.5px] leading-[22.5px]">
            {text}
          </Typography>
        </View>
      </PressableFeedback>
    </View>
  );
}
