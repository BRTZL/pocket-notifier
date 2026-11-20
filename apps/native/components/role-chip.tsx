import type { TopicRole } from "@notifier/contract/topic";
import { Chip } from "heroui-native";

const ROLE_COLORS = {
  owner: "accent",
  publisher: "success",
  subscriber: "default",
} as const satisfies Record<TopicRole, string>;

export function RoleChip({ role }: { role: TopicRole }) {
  return (
    <Chip size="sm" variant="soft" color={ROLE_COLORS[role]}>
      <Chip.Label>{role}</Chip.Label>
    </Chip>
  );
}
