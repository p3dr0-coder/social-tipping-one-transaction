"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = "philia-theme";
const THEME_EVENT = "philia-theme-change";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function subscribeTheme(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function readTheme(): Theme {
  return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

function serverTheme(): Theme {
  return "light";
}

/**
 * daisyUI themes are selected by `data-theme` on the document element, so the provider
 * reads localStorage via useSyncExternalStore and syncs `data-theme` without extra renders.
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
