import type { MyProject } from "@notifier/contract/project";
import { Card, ControlField, Description, Label, Separator, Typography } from "heroui-native";
import { Fragment } from "react";
import { View } from "react-native";

import { type GrantableRole, RoleSelect } from "@/components/role-select";

export type Grants = Record<string, GrantableRole>;

/** Projects the inviter owns, each optionally granted with a role. Keyed by project id. */
export function GrantPicker({
  projects,
  grants,
  onChange,
}: {
  projects: MyProject[];
  grants: Grants;
  onChange: (grants: Grants) => void;
}) {
  if (projects.length === 0) {
    return (
      <Typography color="muted">
        You don't own any project yet, so the invite only creates an account.
      </Typography>
    );
  }

  function toggle(projectId: string, isSelected: boolean) {
    if (isSelected) {
      onChange({ ...grants, [projectId]: "subscriber" });
      return;
    }
    onChange(Object.fromEntries(Object.entries(grants).filter(([id]) => id !== projectId)));
  }

  return (
    <Card>
      <Card.Body className="gap-2">
        {projects.map((project, index) => {
          const role = grants[project.id];
          return (
            <Fragment key={project.id}>
              {index > 0 ? <Separator /> : null}
              <ControlField
                isSelected={role !== undefined}
                onSelectedChange={(value) => toggle(project.id, value)}
              >
                <View className="flex-1">
                  <Label>{project.displayName ?? project.name}</Label>
                  <Description>{project.name}</Description>
                </View>
                <ControlField.Indicator variant="checkbox" />
              </ControlField>
              {role ? (
                <RoleSelect
                  value={role}
                  onChange={(next) => onChange({ ...grants, [project.id]: next })}
                />
              ) : null}
            </Fragment>
          );
        })}
      </Card.Body>
    </Card>
  );
}
