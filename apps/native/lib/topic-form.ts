import { DEFAULT_PRIORITY, Priority } from "@notifier/contract/priority";
import { RETENTION_DAYS, TopicName } from "@notifier/contract/topic";
import { z } from "zod";

/** The editable fields of a topic as typed into the form (all text, priority as a number). */
export type TopicFormValues = {
  name: string;
  displayName: string;
  description: string;
  defaultPriority: number;
  retentionDays: string;
};

export type TopicFormField = keyof TopicFormValues;

export const EMPTY_TOPIC_FORM: TopicFormValues = {
  name: "",
  displayName: "",
  description: "",
  defaultPriority: DEFAULT_PRIORITY,
  retentionDays: String(RETENTION_DAYS.default),
};

/** Whole days within the contract's retention bounds, from a text field. */
const RetentionText = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Enter a number of days")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(RETENTION_DAYS.min, `At least ${RETENTION_DAYS.min} day`)
      .max(RETENTION_DAYS.max, `At most ${RETENTION_DAYS.max} days`),
  );

/** Optional text: blank becomes `null` so an edit can clear it. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((value) => (value.length > 0 ? value : null));
}

const TopicSettingsInput = z.object({
  displayName: optionalText(80),
  description: optionalText(500),
  defaultPriority: Priority,
  retentionDays: RetentionText,
});

/** Settings an owner can change after creation. */
export const UpdateTopicForm = TopicSettingsInput;

/** Creation adds the name, checked with the contract's `TopicName` rules. */
export const CreateTopicForm = TopicSettingsInput.extend({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64, "Keep it under 64 characters")
    .pipe(TopicName),
});
