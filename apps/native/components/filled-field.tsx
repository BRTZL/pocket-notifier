import { FieldError, Input, type InputRef, Label, TextField } from "heroui-native";
import type { ComponentProps, Ref } from "react";

type InputProps = Omit<ComponentProps<typeof Input>, "variant" | "className" | "ref">;

/**
 * A form field built only from HeroUI parts: `Label` above, the filled `Input` as the
 * box (HeroUI owns its single border, including the invalid state), `FieldError` below.
 *
 * Screens validate on submit and clear a field's error when its value changes, so a stale
 * "Email is required" never sits under a filled-in email.
 */
export function FilledField({
  label,
  error,
  isRequired,
  isDisabled,
  inputRef,
  value,
  ...inputProps
}: InputProps & {
  label: string;
  error?: string | null;
  isRequired?: boolean;
  isDisabled?: boolean;
  inputRef?: Ref<InputRef>;
}) {
  const showError = Boolean(error);

  return (
    <TextField isInvalid={showError} isDisabled={isDisabled} isRequired={isRequired}>
      <Label>{label}</Label>
      <Input
        ref={inputRef}
        variant="secondary"
        value={value}
        className="h-14 rounded-2xl px-[18px] text-[16px]"
        {...inputProps}
      />
      <FieldError>{error}</FieldError>
    </TextField>
  );
}
