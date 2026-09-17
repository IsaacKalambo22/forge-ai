"use client";

import { useEffect, useState } from "react";

import { Select } from "@/components/ui";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

function applyTheme(theme: Theme): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

/**
 * Experiment 043. globals.css has defined a dark palette since Experiment 030
 * — entirely OS-driven, `@media (prefers-color-scheme: dark)`, no way to
 * override it from inside the app. This is that override.
 *
 * Starts at "system" on every render, including the first one on the client —
 * `useState`'s initializer cannot read `localStorage` safely here, because
 * this component is also rendered ON THE SERVER for the initial HTML (a
 * Client Component still runs server-side once, to produce markup to
 * hydrate), and `localStorage` does not exist there. The inline script in
 * `layout.tsx` is what makes the PAGE's actual colors correct from the very
 * first paint regardless; this `useEffect` only has to catch the toggle's
 * own displayed value up to match, one tick later — a real but harmless and
 * standard gap, the same one `suppressHydrationWarning` on `<html>` exists
 * for.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // Storage can throw (private browsing, blocked cookies/storage) — the
      // toggle still works for this tab, it just will not remember next time.
    }
  }, []);

  function change(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same as above: the choice just will not survive a reload.
    }
  }

  return (
    <Select
      aria-label="Theme"
      value={theme}
      onChange={(event) => change(event.target.value as Theme)}
    >
      <option value="system">System theme</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </Select>
  );
}
