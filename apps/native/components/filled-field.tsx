import { cn, FieldError, Input, type InputRef, TextField, Typography } from "heroui-native";
import type { ComponentProps, Ref } from "react";
import { View } from "react-native";

type InputProps = Omit<ComponentProps<typeof Input>, "variant" | "className" | "ref">;

/**
 * A filled form field with its label inside the box, as in the sign-in design:
 * 60pt tall, surface colored, 16pt corners. The error shows below the box.
 */
export function FilledField({
  label,
  error,
  isRequired,
  isDisabled,
  inputRef,
  ...inputProps
}: InputProps & {
  label: string;
  error?: string | null;
  isRequired?: boolean;
  isDisabled?: boolean;
  inputRef?: Ref<InputRef>;
}) {
  const isInvalid = Boolean(error);
  return (
    // `isRequired` only reaches the screen reader: the design shows no asterisk, and the
    // screens validate on submit.
    <TextField isInvalid={isInvalid} isDisabled={isDisabled}>
      <View
        className={cn(
          "bg-surface min-h-[60px] justify-center gap-0.5 rounded-2xl px-[18px] py-2",
          isInvalid && "border-danger border",
        )}
      >
        <Typography
          className={cn(
            "text-[12.5px] leading-4 font-bold",
            isInvalid ? "text-danger" : "text-muted",
          )}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {label}
        </Typography>
        <Input
          ref={inputRef}
          variant="secondary"
          accessibilityLabel={isRequired ? `${label}, required` : label}
          className="h-6 min-h-0 rounded-none bg-transparent px-0 py-0 text-[16px] leading-[21px]"
          {...inputProps}
        />
      </View>
      <FieldError>{error}</FieldError>
    </TextField>
  );
}
