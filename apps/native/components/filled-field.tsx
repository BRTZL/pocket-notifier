import { FieldError, Input, type InputRef, Label, TextField } from "heroui-native";
import { type ComponentProps, type Ref, useState } from "react";

type InputProps = Omit<ComponentProps<typeof Input>, "variant" | "className" | "ref">;

/**
 * A form field built only from HeroUI parts: `Label` above, the filled `Input` as the
 * box (HeroUI owns its single border, including the invalid state), `FieldError` below.
 *
 * Screens validate on submit, so an error is hidden again as soon as the value changes:
 * a stale "Email is required" must never sit under a filled-in email.
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
  // The value the current error was raised for. Updated during render when a new error
  // arrives (React's "adjust state on prop change" pattern), so no effect is needed.
  const [snapshot, setSnapshot] = useState({ error, value });
  if (snapshot.error !== error) {
    setSnapshot({ error, value });
  }
  const showError = Boolean(error) && (snapshot.error !== error || value === snapshot.value);

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
      <FieldError>{showError ? error : null}</FieldError>
    </TextField>
  );
}
