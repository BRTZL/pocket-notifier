import type { MyTopic } from "@notifier/contract/topic";
import { Card, ControlField, Description, Label, Separator, Typography } from "heroui-native";
import { Fragment } from "react";
import { View } from "react-native";

import { type GrantableRole, RoleSelect } from "@/components/role-select";

export type Grants = Record<string, GrantableRole>;

/** Topics the inviter owns, each optionally granted with a role. Keyed by topic id. */
export function GrantPicker({
  topics,
  grants,
  onChange,
}: {
  topics: MyTopic[];
  grants: Grants;
  onChange: (grants: Grants) => void;
}) {
  if (topics.length === 0) {
    return (
      <Typography color="muted">
        You don't own any topic yet, so the invite only creates an account.
      </Typography>
    );
  }

  function toggle(topicId: string, isSelected: boolean) {
    if (isSelected) {
      onChange({ ...grants, [topicId]: "subscriber" });
      return;
    }
    onChange(Object.fromEntries(Object.entries(grants).filter(([id]) => id !== topicId)));
  }

  return (
    <Card>
      <Card.Body className="gap-2">
        {topics.map((topic, index) => {
          const role = grants[topic.id];
          return (
            <Fragment key={topic.id}>
              {index > 0 ? <Separator /> : null}
              <ControlField
                isSelected={role !== undefined}
                onSelectedChange={(value) => toggle(topic.id, value)}
              >
                <View className="flex-1">
                  <Label>{topic.displayName ?? topic.name}</Label>
                  <Description>{topic.name}</Description>
                </View>
                <ControlField.Indicator variant="checkbox" />
              </ControlField>
              {role ? (
                <RoleSelect
                  value={role}
                  onChange={(next) => onChange({ ...grants, [topic.id]: next })}
                />
              ) : null}
            </Fragment>
          );
        })}
      </Card.Body>
    </Card>
  );
}
