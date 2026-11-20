import { Chip } from "heroui-native";
import { View } from "react-native";
import { Uniwind, useUniwind } from "uniwind";

const OPTIONS = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
] as const;

/** Light, dark, or following the phone. Applies at once; not remembered across launches. */
export function AppearancePicker() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const current = hasAdaptiveThemes ? "system" : theme;
  return (
    <View className="flex-row gap-2 px-5 py-2" accessibilityRole="radiogroup">
      {OPTIONS.map((option) => {
        const selected = option.key === current;
        return (
          <Chip
            key={option.key}
            size="lg"
            variant={selected ? "primary" : "secondary"}
            color={selected ? "accent" : "default"}
            onPress={() => Uniwind.setTheme(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${option.label} appearance`}
          >
            <Chip.Label className="font-bold">{option.label}</Chip.Label>
          </Chip>
        );
      })}
    </View>
  );
}
