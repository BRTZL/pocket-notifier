import type React from "react";
import { useCallback, useMemo } from "react";
import { Uniwind, useUniwind } from "uniwind";

import { AppThemeContext, type ThemeName } from "@/contexts/app-theme-context";

export const AppThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useUniwind();

  const isLight = useMemo(() => theme === "light", [theme]);

  const isDark = useMemo(() => theme === "dark", [theme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    Uniwind.setTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    Uniwind.setTheme(theme === "light" ? "dark" : "light");
  }, [theme]);

  const value = useMemo(
    () => ({
      currentTheme: theme,
      isLight,
      isDark,
      setTheme,
      toggleTheme,
    }),
    [theme, isLight, isDark, setTheme, toggleTheme],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};
