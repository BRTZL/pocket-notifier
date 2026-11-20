import { useCSSVariable } from "uniwind";

/** Theme colors the app adds on top of HeroUI's (see global.css), plus the HeroUI ones it reads. */
export type TokenColor =
  | "background"
  | "foreground"
  | "foreground-secondary"
  | "surface"
  | "surface-secondary"
  | "muted"
  | "border"
  | "accent"
  | "accent-foreground"
  | "accent-soft"
  | "accent-soft-foreground"
  | "accent-text"
  | "danger";

/** Resolved values of theme color tokens, for native props that take a color (icons, tab bar). */
export function useTokenColors<const T extends readonly TokenColor[]>(
  tokens: T,
): { [K in keyof T]: string } {
  const values = useCSSVariable(tokens.map((token) => `--color-${token}`));
  return values.map((value) => (typeof value === "string" ? value : "transparent")) as {
    [K in keyof T]: string;
  };
}
