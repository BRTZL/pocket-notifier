import { Select, Separator } from "heroui-native";
import { Fragment } from "react";

/** The roles that can be granted to someone else (owners are promoted afterwards). */
export type GrantableRole = "publisher" | "subscriber";

const OPTIONS = [
  { value: "subscriber", label: "Subscriber" },
  { value: "publisher", label: "Publisher" },
] as const satisfies { value: GrantableRole; label: string }[];

export function RoleSelect({
  value,
  onChange,
  isDisabled,
}: {
  value: GrantableRole;
  onChange: (role: GrantableRole) => void;
  isDisabled?: boolean;
}) {
  return (
    <Select
      isDisabled={isDisabled}
      value={OPTIONS.find((option) => option.value === value)}
      onValueChange={(option) => {
        if (option && !Array.isArray(option)) {
          onChange(option.value as GrantableRole);
        }
      }}
    >
      <Select.Trigger>
        <Select.Value placeholder="Role" />
        <Select.TriggerIndicator />
      </Select.Trigger>
      <Select.Portal>
        <Select.Overlay />
        <Select.Content presentation="popover" width="trigger">
          {OPTIONS.map((option, index) => (
            <Fragment key={option.value}>
              {index > 0 ? <Separator /> : null}
              <Select.Item value={option.value} label={option.label} />
            </Fragment>
          ))}
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
