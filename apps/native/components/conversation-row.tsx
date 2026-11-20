import type { ConversationSummary } from "@notifier/contract/conversation";
import { cn, PressableFeedback, Typography } from "heroui-native";
import { View } from "react-native";

import { ChatAvatar } from "@/components/chat-avatar";
import { Icon } from "@/components/icon";
import { conversationAvatar } from "@/lib/chat-avatar";
import { chatTime } from "@/lib/format";

/** `Sender: text`, or just the text; the title wins over the body when there is one. */
function previewText(conversation: ConversationSummary): string {
  const { title, body } = conversation.lastMessage;
  return title ?? body;
}

function UnreadCount({ conversation }: { conversation: ConversationSummary }) {
  const count = conversation.unreadCount;
  if (count === 0) {
    return null;
  }
  const isUrgent = conversation.lastMessage.priority === 5;
  return (
    <View
      className={cn(
        "h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px]",
        conversation.muted ? "bg-surface-tertiary" : isUrgent ? "bg-danger" : "bg-accent",
      )}
    >
      <Typography
        className={cn(
          "text-[12.5px] leading-4 font-bold",
          conversation.muted ? "text-muted" : "text-accent-foreground",
        )}
      >
        {count > 99 ? "99+" : String(count)}
      </Typography>
    </View>
  );
}

/** One chat in the inbox: avatar, name, `Sender: preview`, time and unread count. */
export function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: ConversationSummary;
  onPress: () => void;
}) {
  const unread = conversation.unreadCount > 0;
  const { senderName, priority, createdAt } = conversation.lastMessage;
  const preview = previewText(conversation);
  const isUrgent = priority === 5;

  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      className="flex-row items-center gap-3.5 px-5 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`${conversation.title}. ${unread ? `${conversation.unreadCount} unread. ` : ""}${senderName ? `${senderName}: ` : ""}${preview}`}
    >
      <PressableFeedback.Highlight />
      <ChatAvatar subject={conversationAvatar(conversation)} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2.5">
          <Typography
            numberOfLines={1}
            className={cn(
              "flex-1 text-[17px] leading-[22px]",
              unread ? "font-heavy" : "font-semibold",
            )}
          >
            {conversation.title}
          </Typography>
          <Typography
            className={cn(
              "text-[13px] leading-[18px]",
              unread && !conversation.muted ? "text-accent font-semibold" : "text-muted",
            )}
          >
            {chatTime(createdAt)}
          </Typography>
        </View>
        <View className="mt-[3px] min-h-[22px] flex-row items-center gap-2.5">
          <View className="min-w-0 flex-1 flex-row items-center gap-1">
            {isUrgent ? <Icon name="error" size={17} color="danger" /> : null}
            <Typography
              numberOfLines={1}
              className={cn(
                "flex-1 text-[15px] leading-[21px]",
                unread ? "text-foreground-secondary" : "text-muted",
              )}
            >
              {senderName ? (
                <Typography className="text-foreground text-[15px] font-bold">
                  {senderName}:{" "}
                </Typography>
              ) : null}
              {preview}
            </Typography>
          </View>
          <UnreadCount conversation={conversation} />
        </View>
      </View>
    </PressableFeedback>
  );
}
