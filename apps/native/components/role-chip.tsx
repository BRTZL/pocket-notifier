import type { ProjectRole } from "@notifier/contract/project";
import { Chip } from "heroui-native";

const ROLE_COLORS = {
  owner: "accent",
  publisher: "success",
  subscriber: "default",
} as const satisfies Record<ProjectRole, string>;

export function RoleChip({ role }: { role: ProjectRole }) {
  return (
    <Chip size="sm" variant="soft" color={ROLE_COLORS[role]}>
      <Chip.Label>{role}</Chip.Label>
    </Chip>
  );
}
