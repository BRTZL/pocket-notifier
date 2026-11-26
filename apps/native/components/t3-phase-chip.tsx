import type { T3Phase } from "@notifier/contract/t3";
import { Chip } from "heroui-native";

import { T3_PHASE_LABELS } from "@/lib/t3";

/** A T3 thread's phase as a small colored chip: "Running", "Needs approval", "Failed". */
export function T3PhaseChip({ phase }: { phase: T3Phase }) {
  const { label, tone } = T3_PHASE_LABELS[phase];
  return (
    <Chip size="sm" variant="soft" color={tone}>
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}
