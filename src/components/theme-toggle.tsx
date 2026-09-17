"use client";

import { useSyncExternalStore } from "react";

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

function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.6 3.4l-1.13 1.13M4.53 11.47L3.4 12.6M12.6 12.6l-1.13-1.13M4.53 4.53L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 9.6A5.6 5.6 0 1 1 6.4 2.5a4.35 4.35 0 0 0 7.1 7.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: () => React.JSX.Element }> = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

/**
 * Experiment 043 shipped this as a text `<select>`. Experiment 045 replaced
 * it with icons — a `<select>`'s `<option>` cannot hold an `<svg>`, so a
 * segmented group of toggle buttons is the icon-bearing equivalent, not a
 * cosmetic skin on the same element. `role="group"` + `aria-pressed` (not
 * `radiogroup`/`radio`) deliberately skips ARIA's roving-tabindex/arrow-key
 * requirement for radio groups — three independently-tabbable buttons is
 * simpler and just as usable for three items.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`: the theme lives in
 * localStorage, external to React, and reading it inside an effect to seed
 * local state is exactly the "sync on mount" anti-pattern React's own eslint
 * rule (`react-hooks/set-state-in-effect`) flags — it causes an extra render
 * and, worse here, a control that visibly shows "System" for one frame before
 * correcting itself even when a real choice was stored. This hook exists
 * specifically for reading a value React does not own; `layout.tsx`'s
 * pre-hydration script is what keeps the PAGE's actual colors correct from
 * the first paint regardless of which value this component settles on.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cx(
              "inline-flex min-h-9 min-w-9 items-center justify-center rounded-[5px] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
