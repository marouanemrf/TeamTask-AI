/** Reads a design token from src/styles/theme.css (e.g. for three.js materials). */
export function cssVar(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
