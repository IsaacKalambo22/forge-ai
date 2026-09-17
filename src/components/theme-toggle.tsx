"use client";

import { useSyncExternalStore } from "react";

import { Select } from "@/components/ui";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

// No native event fires in the SAME tab that wrote to localStorage — the
// browser's own "storage" event is cross-tab only, by design. This is the
// same-tab half of it, so `useSyncExternalStore` below sees the write
// immediately, not on whatever unrelated render happens to come next.
const THEME_EVENT = "forge-ai:theme";

function applyTheme(theme: Theme): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function getSnapshot(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Storage can throw (private browsing, blocked cookies/storage) — the
    // toggle still works for this tab, it just will not remember next time.
    return "system";
  }
}

// The server has no localStorage and no OS preference to read — "system" is
// also what the pre-hydration page actually shows for a visitor with no
// stored choice, so this is not a guess, it is the true initial state.
function getServerSnapshot(): Theme {
  return "system";
}

function setTheme(next: Theme): void {
  applyTheme(next);
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Same as getSnapshot above: the choice just will not survive a reload.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Experiment 043. globals.css has had a full dark palette since Experiment
 * 030 — entirely OS-driven, `@media (prefers-color-scheme: dark)`, no way to
 * override it from inside the app. This is that override.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`: the theme lives in
 * localStorage, external to React, and reading it inside an effect to seed
 * local state is exactly the "sync on mount" anti-pattern React's own eslint
 * rule (`react-hooks/set-state-in-effect`) flags — it causes an extra render
 * and, worse here, a `<select>` that visibly shows "System" for one frame
 * before correcting itself even when a real choice was stored. This hook
 * exists specifically for reading a value React does not own; `layout.tsx`'s
 * pre-hydration script is what keeps the PAGE's actual colors correct from
 * the first paint regardless of which value this component settles on.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <Select
      aria-label="Theme"
      value={theme}
      onChange={(event) => setTheme(event.target.value as Theme)}
    >
      <option value="system">System theme</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </Select>
  );
}
