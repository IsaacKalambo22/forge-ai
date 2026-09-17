# Experiment 043 — A Choice, Not Just an Inference

## Objective

Isaac, directly: "lets add the theme switcher as well and fix the issues" — the
theme switcher as the concrete ask, and continued work on "not convincing"
(Experiment 042's one deliberately-unaddressed item) as the open-ended one.

## What happened — the dark palette already existed, and the gap was narrower than it looked

`globals.css` has carried a complete dark palette since Experiment 030 —
`@media (prefers-color-scheme: dark)`, every token redefined. Checked directly
before writing anything: dark mode already worked, purely OS-driven, with no
way to override it from inside the app. Someone whose OS is set to light but
wants this app dark — or the other way round — had no lever to pull. The
actual missing piece was an override, not a palette.

## What We Built

| Piece | What it is |
| --- | --- |
| `globals.css` | The existing dark block now lives under `:root:not([data-theme="light"])` (still OS-driven, still yields to an explicit choice), plus a second, identical block under `:root[data-theme="dark"]` with no media query — the manual override. A comment ties the two together and says they must stay in sync; plain CSS has no way to share the declarations without duplicating them. |
| `components/theme-toggle.tsx` | A `<Select>` — System / Light / Dark — using `useSyncExternalStore` against `localStorage`, not `useState` + `useEffect`. See Decisions for why that distinction mattered, not just stylistically. |
| `layout.tsx` | A `next/script` `beforeInteractive` inline script that reapplies a stored choice to `<html data-theme>` before hydration — without it, a visitor who chose "Dark" would see a flash of their OS's light theme on every load, then a snap to dark. `suppressHydrationWarning` on `<html>` because this script intentionally makes the server-rendered attribute and the client's differ, which is correct here, not a bug to silence blindly. |
| `shell.tsx` / `layout.tsx` | The toggle is reachable from the authenticated `TopBar` AND the signed-out lock screen — a visitor's first-ever interaction with this app can be "make it readable for me," not something gated behind an account. |
| `globals.css` — `body` transition | 150ms `background-color`/`color` transition (respecting `prefers-reduced-motion`), so switching reads as a deliberate change, not a jump cut. |

## Important concepts

**`useSyncExternalStore` exists for exactly this — reading a value React does
not own.** The first draft used `useState` seeded from `localStorage` inside a
`useEffect`. It worked, and the project's own eslint config (React's
`react-hooks/set-state-in-effect` rule) refused to let it ship: calling
`setState` synchronously inside an effect to mirror an external source is the
specific anti-pattern that hook exists to replace. Past the lint error, it was
also a genuinely worse implementation — the `<select>` would render "System"
for one frame even when a real choice was stored, then correct itself. Rewriting
around `useSyncExternalStore` (`getSnapshot` reads `localStorage` directly,
`getServerSnapshot` returns the true value for a server that has no
localStorage to read) removed both problems at once, not just the lint one.

**A native `storage` event does not fire in the tab that wrote it.** Only in
OTHER tabs — a deliberate browser design choice, not a bug to work around
quietly. `theme-toggle.tsx` dispatches its own `forge-ai:theme` event
alongside every write so `useSyncExternalStore`'s subscription sees same-tab
changes immediately; the native event is still listened for too, so choosing a
theme in one tab now updates any other open tab for free.

## Verified live

`pnpm check`'s `e2e`/`visual` gates need their own spawned server and could not
run — Isaac's own `pnpm dev` was still holding the project's Next.js dev lock,
the same conflict Experiment 042 hit. Checked by hand against that same running
server instead:

```text
initial (system) background:        rgb(250, 250, 250)
after selecting Dark:                rgb(9, 9, 11)
data-theme attribute:                "dark"
after a full page reload:            rgb(9, 9, 11)   — no reversion, no flash back to light
after selecting Light:                rgb(250, 250, 250)
after selecting System:              data-theme attribute removed entirely
console/page errors across all of the above: none
```

`types`, `lint` (the `react-hooks/set-state-in-effect` error included — clean
after the rewrite), and the new `pnpm visual` assertions (extended, not yet
run through `pnpm check` for the reason above) were checked directly.

## Decisions

**Three states (System / Light / Dark), not a two-way toggle.** A plain
light/dark switch would silently throw away "I didn't choose, follow my OS" —
the DEFAULT behavior this app already had — the moment anyone touched it once.
Keeping System as a real, selectable option (and what "not stored" already
means) means opting into the manual override is reversible.

**Duplicated CSS blocks over a preprocessor or a JS-computed stylesheet.**
Plain CSS custom properties cannot share a declaration list between two
selectors without repeating it. Reaching for a build step to avoid ~20 lines
of duplication would be exactly the premature tooling this project has
avoided everywhere else; a comment stating the two blocks must move together
is the honest, proportionate fix.

**Visual identity ("not convincing") beyond dark mode: still not attempted
further.** A working theme switcher is real, concrete progress on that
complaint — a from-scratch color palette, icons, or a different type scale
would be a bigger, more subjective step, and still better taken with
direction than guessed.

## Not verified

- **`pnpm check`'s `e2e`/`visual` gates**, specifically — same environmental
  conflict as Experiment 042, not a code defect. Queued.
- **The actual pre-hydration flash, frame-by-frame.** Confirmed the STATE
  survives a reload (background color matches before and after); did not
  capture the load sequence itself to prove zero intermediate frames — that
  needs a trace, not a `waitForLoadState` check.

## Status

| Piece | State |
| --- | --- |
| Manual override (System / Light / Dark) on top of the existing OS-driven dark palette | ✅ Verified live |
| No flash-of-wrong-theme on reload | ✅ Verified live (end-state) — see Not verified for the frame-level caveat |
| Reachable signed out and signed in | ✅ Shipped in both `layout.tsx`'s lock screen and `shell.tsx`'s `TopBar` |
| Zero lint errors, including `react-hooks/set-state-in-effect` | ✅ Verified — required the `useSyncExternalStore` rewrite |
| `pnpm visual` coverage | ✅ Written, ⏳ not yet run through `pnpm check` — see Not verified |

## Next Step

Re-run `pnpm check` in full once a dev server isn't holding the project's
lock — this and Experiment 042 both have `e2e`/`visual` queued behind the same
conflict. Beyond that: visual identity is still an open, Isaac-directed thread
if there's a specific direction wanted (accent color, icons, type scale).
