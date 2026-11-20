import {
  avatarColor,
  avatarInitials,
  type Conversation,
  type Sender,
} from "@notifier/contract/avatar";
import { Avatar, cn } from "heroui-native";
import { View } from "react-native";

type AvatarSubject = {
  /** Stable key that picks the generated color. */
  id: string;
  /** Shown as initials when there is no icon. */
  name: string;
  iconUrl?: string | undefined;
};

/** One circular avatar: the icon when there is one, else initials on the palette color. */
function GeneratedAvatar({
  subject,
  size,
  className,
  textClassName,
}: {
  subject: AvatarSubject;
  size: "sm" | "md" | "lg";
  className?: string;
  textClassName?: string;
}) {
  return (
    <Avatar size={size} background={null} alt={subject.name} className={className}>
      {subject.iconUrl ? <Avatar.Image source={{ uri: subject.iconUrl }} /> : null}
      <Avatar.Fallback
        // The one computed color in the app: it comes from the contract's avatar palette,
        // so the web dashboard and the phone draw the same avatar for the same id.
        styles={{ container: { backgroundColor: avatarColor(subject.id) } }}
        classNames={{ text: cn("font-semibold text-white", textClassName) }}
      >
        {avatarInitials(subject.name)}
      </Avatar.Fallback>
    </Avatar>
  );
}

export type SenderAvatarProps = {
  /** Topic name; the large avatar when there is no conversation. */
  topic: string;
  conversation: Conversation | null;
  sender: Sender | null;
  size?: "md" | "lg";
};

/**
 * The message avatar: the conversation (or the topic when there is none) as the large
 * circle, with the sender as a small badge in the corner when there is one.
 */
export function SenderAvatar({ topic, conversation, sender, size = "md" }: SenderAvatarProps) {
  const main: AvatarSubject = conversation
    ? {
        id: conversation.id,
        name: conversation.title ?? conversation.id,
        iconUrl: conversation.iconUrl,
      }
    : { id: topic, name: topic };
  const badge: AvatarSubject | null = sender
    ? { id: sender.id, name: sender.name ?? sender.id, iconUrl: sender.iconUrl }
    : null;

  return (
    <View className="relative">
      <GeneratedAvatar subject={main} size={size} />
      {badge ? (
        <View
          className={cn(
            "bg-background absolute -right-1 -bottom-1 rounded-full p-0.5",
            size === "lg" && "-right-0.5 -bottom-0.5",
          )}
        >
          <GeneratedAvatar
            subject={badge}
            size="sm"
            className={size === "lg" ? "size-7" : "size-5"}
            textClassName={size === "lg" ? "text-[11px]" : "text-[8px]"}
          />
        </View>
      ) : null}
    </View>
  );
}
