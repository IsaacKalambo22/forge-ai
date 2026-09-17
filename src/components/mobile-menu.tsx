"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Experiment 044. `TopBar` (shell.tsx) held four things in one `justify-between`
 * row — the wordmark, nav links, the theme toggle, the signed-in user/sign-out
 * — and none of it wrapped or collapsed. Adding the theme toggle (Experiment
 * 043) was what tipped it into genuine horizontal overflow below `sm:`
 * (measured: 440px of content in a 375px viewport, the theme `<select>`
 * clipped off the right edge entirely and unreachable) — this is the fix.
 *
 * `children` renders EXACTLY ONCE — passed down from the Server Component
 * `TopBar`, not duplicated between a "mobile version" and a "desktop version".
 * Two copies of `ThemeToggle` would mean two elements answering to
 * `getByLabel("Theme")`, breaking `pnpm visual`'s locators, and two sources of
 * truth for something that must only ever be one. Tailwind's responsive
 * classes below decide whether that ONE copy renders inline in the header row
 * (`sm:` and up, always, regardless of `open`) or inside a toggled dropdown
 * (below `sm:`, following `open`) — no duplication, one state to reason about.
 */
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Closes on navigation — picking a nav link from the open menu should not
  // leave the menu open over the new page. Deliberately NOT a `useEffect`
  // keyed on `pathname`: React's own guidance for "adjust state when a prop
  // changes" (and this project's lint config enforces it —
  // `react-hooks/set-state-in-effect`) is to compare during render and call
  // setState conditionally there, not synchronously inside an effect body.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-foreground sm:hidden"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <div
        className={cx(
          "absolute inset-x-0 top-14 z-10 flex flex-col gap-4 border-b border-border bg-surface p-4 shadow-lg",
          "sm:static sm:z-auto sm:w-auto sm:flex-row sm:items-center sm:gap-6 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none",
          open ? "flex" : "hidden sm:flex",
        )}
      >
        {children}
      </div>
    </>
  );
}
