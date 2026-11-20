import { useState } from "react";

import type { TopicFormField, TopicFormValues } from "@/lib/topic-form";

/** Values and inline errors of the topic form; editing a field clears its error. */
export function useTopicForm(initial: TopicFormValues) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<TopicFormField, string>>>({});

  function setField<K extends TopicFormField>(field: K, value: TopicFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return { values, setValues, errors, setErrors, setField };
}
