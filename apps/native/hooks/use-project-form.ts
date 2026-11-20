import { useState } from "react";

import type { ProjectFormField, ProjectFormValues } from "@/lib/project-form";

/** Values and inline errors of the project form; editing a field clears its error. */
export function useProjectForm(initial: ProjectFormValues) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<ProjectFormField, string>>>({});

  function setField<K extends ProjectFormField>(field: K, value: ProjectFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return { values, setValues, errors, setErrors, setField };
}
