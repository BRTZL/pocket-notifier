import type { ConversationSummary } from "@notifier/contract/conversation";
import { cn, PressableFeedback, Typography } from "heroui-native";
import { View } from "react-native";

import { ChatAvatar } from "@/components/chat-avatar";
import { Icon } from "@/components/icon";
import { conversationAvatar } from "@/lib/chat-avatar";
import { chatTime } from "@/lib/format";

const ATTACHMENT_LABELS = { image: "Photo", video: "Video", pdf: "PDF" } as const;

/** The last message's title, else its body, else what it carries ("Photo", a file name). */
function previewText(conversation: ConversationSummary): string {
  const { title, body, attachment } = conversation.lastMessage;
  if (title || body) {
    return title ?? body;
  }
  if (!attachment) {
    return "";
  }
  return attachment.kind === "file" ? attachment.name : ATTACHMENT_LABELS[attachment.kind];
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

/**
 * One chat in the inbox: avatar, feature name with its project, the last message, time and
 * unread count. The sender is left out: it is almost always the same agent.
 */
export function ConversationRow({
  conversation,
  onPress,
  isSelected = false,
}: {
  conversation: ConversationSummary;
  onPress: () => void;
  /** Open in the right pane of a two-pane layout. */
  isSelected?: boolean;
}) {
  const unread = conversation.unreadCount > 0;
  const { priority, createdAt } = conversation.lastMessage;
  // A feature thread names its project; a project-level thread already is the project.
  const project = conversation.kind === "conversation" ? conversation.projectTitle : null;
  const preview = previewText(conversation);
  const isUrgent = priority === 5;

  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      className={cn("flex-row items-center gap-3.5 px-5 py-2.5", isSelected && "bg-accent-soft")}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${conversation.title}${project ? `, ${project}` : ""}. ${unread ? `${conversation.unreadCount} unread. ` : ""}${preview}`}
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
            {project ? (
              <Typography className="text-muted text-[15px] font-medium">
                {"  ·  "}
                {project}
              </Typography>
            ) : null}
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
              {preview}
            </Typography>
          </View>
          <UnreadCount conversation={conversation} />
        </View>
      </View>
    </PressableFeedback>
  );
}
