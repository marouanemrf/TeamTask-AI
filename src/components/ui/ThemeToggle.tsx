import { useTheme } from "../../hooks/useTheme";
import { MoonIcon, SunIcon } from "./Icons";

/** Switches between light and dark mode (remembered in this browser). */
function ThemeToggle({ className = "sidebar__link sidebar__theme" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "light" ? "dark" : "light";
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
      <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}

export default ThemeToggle;
