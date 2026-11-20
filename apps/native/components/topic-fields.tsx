import { PRIORITY_NAMES, type Priority } from "@notifier/contract/priority";
import { RETENTION_DAYS } from "@notifier/contract/topic";
import {
  Description,
  FieldError,
  Input,
  Label,
  Select,
  Separator,
  TextArea,
  TextField,
} from "heroui-native";
import { Fragment } from "react";
import { View } from "react-native";

import type { TopicFormField, TopicFormValues } from "@/lib/topic-form";

const PRIORITIES = ([1, 2, 3, 4, 5] as const).map((priority) => ({
  value: String(priority),
  label: `${priority} · ${PRIORITY_NAMES[priority]}`,
}));

function priorityOption(priority: number) {
  return PRIORITIES.find((option) => option.value === String(priority));
}

/** Priority 1–5 with its name, e.g. "3 · default". */
export function PrioritySelect({
  value,
  onChange,
  isDisabled,
}: {
  value: number;
  onChange: (priority: Priority) => void;
  isDisabled?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <Label>Default priority</Label>
      <Select
        presentation="dialog"
        isDisabled={isDisabled}
        value={priorityOption(value)}
        onValueChange={(option) => {
          if (option && !Array.isArray(option)) {
            onChange(Number(option.value) as Priority);
          }
        }}
      >
        <Select.Trigger>
          <Select.Value placeholder="Choose a priority" />
          <Select.TriggerIndicator />
        </Select.Trigger>
        <Select.Portal>
          <Select.Overlay />
          <Select.Content presentation="dialog">
            <Select.ListLabel className="mb-2">Default priority</Select.ListLabel>
            {PRIORITIES.map((option, index) => (
              <Fragment key={option.value}>
                {index > 0 ? <Separator /> : null}
                <Select.Item value={option.value} label={option.label} />
              </Fragment>
            ))}
          </Select.Content>
        </Select.Portal>
      </Select>
      <Description>Used when a message does not set its own priority.</Description>
    </View>
  );
}

/**
 * The topic form's fields. `name` is only shown when creating: it is part of publish
 * URLs and cannot change afterwards.
 */
export function TopicFields({
  values,
  errors,
  onChange,
  withName,
  isDisabled,
}: {
  values: TopicFormValues;
  errors: Partial<Record<TopicFormField, string>>;
  onChange: <K extends TopicFormField>(field: K, value: TopicFormValues[K]) => void;
  withName: boolean;
  isDisabled?: boolean;
}) {
  return (
    <View className="gap-4">
      {withName ? (
        <TextField isRequired isInvalid={Boolean(errors.name)} isDisabled={isDisabled}>
          <Label>Name</Label>
          <Input
            value={values.name}
            onChangeText={(text) => onChange("name", text)}
            placeholder="e.g. ci-alerts"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
          />
          {errors.name ? null : (
            <Description>Used in publish URLs. Lowercase letters, digits, - and _.</Description>
          )}
          <FieldError>{errors.name}</FieldError>
        </TextField>
      ) : null}
      <TextField isInvalid={Boolean(errors.displayName)} isDisabled={isDisabled}>
        <Label>Display name</Label>
        <Input
          value={values.displayName}
          onChangeText={(text) => onChange("displayName", text)}
          placeholder="Optional"
          maxLength={80}
        />
        <FieldError>{errors.displayName}</FieldError>
      </TextField>
      <TextField isInvalid={Boolean(errors.description)} isDisabled={isDisabled}>
        <Label>Description</Label>
        <TextArea
          value={values.description}
          onChangeText={(text) => onChange("description", text)}
          placeholder="Optional"
          maxLength={500}
        />
        <FieldError>{errors.description}</FieldError>
      </TextField>
      <PrioritySelect
        value={values.defaultPriority}
        onChange={(priority) => onChange("defaultPriority", priority)}
        isDisabled={isDisabled}
      />
      <TextField isRequired isInvalid={Boolean(errors.retentionDays)} isDisabled={isDisabled}>
        <Label>Keep messages for (days)</Label>
        <Input
          value={values.retentionDays}
          onChangeText={(text) => onChange("retentionDays", text)}
          keyboardType="number-pad"
          maxLength={3}
        />
        {errors.retentionDays ? null : (
          <Description>
            {RETENTION_DAYS.min}–{RETENTION_DAYS.max} days.
          </Description>
        )}
        <FieldError>{errors.retentionDays}</FieldError>
      </TextField>
    </View>
  );
}
