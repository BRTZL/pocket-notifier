import type { InboxMessage } from "@notifier/contract/message";
import { Chip, cn, ListGroup, Typography } from "heroui-native";
import { View } from "react-native";

import { SenderAvatar } from "@/components/sender-avatar";
import { isHighPriority, messageHeadline, relativeTime } from "@/lib/format";

/** Priority 4–5 marker, shared by the inbox rows and the detail screen. */
export function PriorityChip({ priority }: { priority: number }) {
  if (!isHighPriority(priority)) {
    return null;
  }
  const isUrgent = priority === 5;
  return (
    <Chip size="sm" variant="soft" color={isUrgent ? "danger" : "warning"}>
      <Chip.Label>{isUrgent ? "Urgent" : "High"}</Chip.Label>
    </Chip>
  );
}

/** Tags as small chips. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <Chip key={tag} size="sm" variant="soft" color="default">
          <Chip.Label>{tag}</Chip.Label>
        </Chip>
      ))}
    </>
  );
}

export function MessageRow({ message, onPress }: { message: InboxMessage; onPress: () => void }) {
  const unread = !message.read;
  const hasChips = message.tags.length > 0 || isHighPriority(message.priority);

  return (
    <ListGroup.Item
      onPress={onPress}
      className="active:bg-surface-secondary items-start"
      accessibilityRole="button"
      accessibilityLabel={`${unread ? "Unread. " : ""}${messageHeadline(message)}. ${message.title ?? message.body}`}
    >
      <ListGroup.ItemPrefix>
        <SenderAvatar
          topic={message.topic}
          conversation={message.conversation}
          sender={message.sender}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent className="gap-1">
        <View className="flex-row items-center gap-2">
          <Typography type="body-sm" color="muted" truncate className="flex-1">
            {messageHeadline(message)}
          </Typography>
          <Typography type="body-xs" color="muted">
            {relativeTime(message.createdAt)}
          </Typography>
          <View
            className={cn("size-2.5 rounded-full", unread ? "bg-accent" : "bg-transparent")}
            accessibilityElementsHidden
          />
        </View>
        {message.title ? (
          <Typography weight={unread ? "bold" : "semibold"} numberOfLines={1}>
            {message.title}
          </Typography>
        ) : null}
        {message.body ? (
          <Typography
            type="body-sm"
            color={message.title ? "muted" : "default"}
            weight={!message.title && unread ? "semibold" : undefined}
            numberOfLines={2}
          >
            {message.body}
          </Typography>
        ) : null}
        {hasChips ? (
          <View className="mt-1 flex-row flex-wrap gap-1.5">
            <PriorityChip priority={message.priority} />
            <TagChips tags={message.tags} />
          </View>
        ) : null}
      </ListGroup.ItemContent>
    </ListGroup.Item>
  );
}
