import { useSyncExternalStore } from "react";
import { setTheme, subscribeTheme } from "../utils/theme";
import type { Theme } from "../utils/theme";

export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  const toggle = () => setTheme(theme === "light" ? "dark" : "light");
  return { theme, toggle };
}
