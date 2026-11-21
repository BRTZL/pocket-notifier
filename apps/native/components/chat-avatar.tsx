import { avatarColor, avatarInitials } from "@notifier/contract/avatar";
import { Image } from "expo-image";
import { Avatar } from "heroui-native";
import { View } from "react-native";

import { Icon } from "@/components/icon";
import type { ChatAvatarSubject } from "@/lib/chat-avatar";

/**
 * The round avatar of a chat row or thread header. `size` is in points; the prototype
 * uses 52 in lists and 40 in headers.
 */
export function ChatAvatar({ subject, size = 52 }: { subject: ChatAvatarSubject; size?: number }) {
  const box = { width: size, height: size };
  if (subject.kind === "glyph") {
    return (
      <View
        className="bg-surface items-center justify-center rounded-full"
        style={box}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name={subject.glyph} size={Math.round(size * 0.46)} />
      </View>
    );
  }
  return (
    <Avatar background={null} alt={subject.name} style={box}>
      {subject.iconUrl ? (
        // expo-image caches icons on disk; a failed load shows the initials below.
        <Avatar.Image source={{ uri: subject.iconUrl }} asChild>
          <Image style={{ width: "100%", height: "100%" }} contentFit="cover" />
        </Avatar.Image>
      ) : null}
      <Avatar.Fallback
        // The one computed color in the app: the contract's avatar palette, so the web
        // dashboard and the phone draw the same avatar for the same id.
        styles={{
          container: { backgroundColor: avatarColor(subject.id) },
          text: { fontSize: Math.round(size * 0.38) },
        }}
        classNames={{ text: "font-semibold text-white" }}
      >
        {avatarInitials(subject.name)}
      </Avatar.Fallback>
    </Avatar>
  );
}
