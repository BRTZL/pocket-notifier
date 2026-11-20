import { z } from "zod";

const DIGITS = /^\d+$/u;

/**
 * Whole days typed into a text field, within `min`–`max`. Blank is allowed only when
 * `optional`, and parses to `undefined`.
 */
export function daysText({ min, max, optional }: { min: number; max: number; optional: boolean }) {
  return z
    .string()
    .trim()
    .refine((text) => optional || text.length > 0, "Enter a number of days")
    .refine((text) => text.length === 0 || DIGITS.test(text), "Enter a number of days")
    .transform((text) => (text.length > 0 ? Number(text) : undefined))
    .refine(
      (days) => days === undefined || (days >= min && days <= max),
      `Between ${min} and ${max} days`,
    );
}
