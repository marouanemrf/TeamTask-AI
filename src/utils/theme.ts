/**
 * Light / dark mode. The choice is kept in this browser (localStorage); without one the app
 * follows the operating system setting. The resolved theme is set on <html data-theme="…">,
 * which switches the colour tokens in styles/theme.css.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "teamtask-theme";
const listeners = new Set<() => void>();
const systemQuery = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: light)") : undefined;

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return storedTheme() ?? (systemQuery?.matches ? "light" : "dark");
}

function apply() {
  document.documentElement.dataset.theme = currentTheme();
  listeners.forEach((listener) => listener());
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* not remembered, still applied for this page */
  }
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called once before the first render. */
export function initTheme() {
  apply();
  systemQuery?.addEventListener?.("change", () => {
    if (!storedTheme()) apply();
  });
}
