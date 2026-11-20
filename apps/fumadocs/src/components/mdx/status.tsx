const STYLES = {
  decided: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
  open: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  later: "border-fd-border bg-fd-muted text-fd-muted-foreground",
} as const;

const LABELS = {
  decided: "Decided",
  open: "Open",
  later: "Later",
} as const;

export type StatusKind = keyof typeof STYLES;

export function Status({ kind }: { kind: StatusKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 align-middle text-xs font-medium ${STYLES[kind]}`}
    >
      {LABELS[kind]}
    </span>
  );
}
