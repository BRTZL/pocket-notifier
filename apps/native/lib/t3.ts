import type { T3Phase } from "@notifier/contract/t3";

type Tone = "warning" | "danger" | "accent" | "success" | "default";

/** How a T3 thread's phase reads on the phone. */
export const T3_PHASE_LABELS: Record<T3Phase, { label: string; tone: Tone }> = {
  waiting_for_input: { label: "Needs your answer", tone: "warning" },
  waiting_for_approval: { label: "Needs approval", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  starting: { label: "Starting", tone: "accent" },
  running: { label: "Running", tone: "accent" },
  completed: { label: "Finished", tone: "success" },
  idle: { label: "Idle", tone: "default" },
};

/** Phases worth a chip in the inbox: the thread works, waits or broke. */
export const T3_CHIP_PHASES: readonly T3Phase[] = [
  "waiting_for_input",
  "waiting_for_approval",
  "failed",
  "starting",
  "running",
];

/** The bridge counts as offline when its heartbeat (every minute) is older than this. */
export const BRIDGE_OFFLINE_MS = 3 * 60 * 1000;
