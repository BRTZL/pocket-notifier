import { avatarColor, avatarInitials } from "@notifier/contract/avatar";
import type { UserSummary } from "@notifier/contract/common";
import { Avatar } from "heroui-native";

/** A person's photo, or their initials on the contract's generated color. */
export function UserAvatar({
  user,
  size = "md",
}: {
  user: Pick<UserSummary, "id" | "name" | "email" | "image">;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Avatar size={size} background={null} alt={user.name}>
      {user.image ? <Avatar.Image source={{ uri: user.image }} /> : null}
      <Avatar.Fallback
        styles={{ container: { backgroundColor: avatarColor(user.id) } }}
        classNames={{ text: "font-semibold text-white" }}
      >
        {avatarInitials(user.name || user.email)}
      </Avatar.Fallback>
    </Avatar>
  );
}
