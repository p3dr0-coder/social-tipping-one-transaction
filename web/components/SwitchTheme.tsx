"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { useTheme } from "~~/components/ThemeProvider";

const subscribeNoop = () => () => {};

export const SwitchTheme = ({ className }: { className?: string }) => {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const isDarkMode = theme === "dark";

  if (!mounted) return null;

  return (
    <div className={`flex space-x-2 h-8 items-center justify-center text-sm ${className ?? ""}`}>
      <input
        id="theme-toggle"
        type="checkbox"
        className="toggle bg-secondary toggle-primary hover:bg-accent transition-all"
        onChange={() => setTheme(isDarkMode ? "light" : "dark")}
        checked={isDarkMode}
      />
      <label htmlFor="theme-toggle" className={`swap swap-rotate ${!isDarkMode ? "swap-active" : ""}`}>
        <SunIcon className="swap-on h-5 w-5" />
        <MoonIcon className="swap-off h-5 w-5" />
      </label>
    </div>
  );
};
