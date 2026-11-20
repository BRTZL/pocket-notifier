import type { z } from "zod";

/** The first validation message per top-level field, for `FieldError`s. */
export function fieldErrors<K extends string>(error: z.ZodError): Partial<Record<K, string>> {
  const errors: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const [key] = issue.path;
    if (typeof key === "string" && !(key in errors)) {
      errors[key as K] = issue.message;
    }
  }
  return errors;
}
