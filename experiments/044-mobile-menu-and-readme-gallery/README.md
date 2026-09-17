# Experiment 044 — A Regression, and a First Impression

## Objective

Isaac, after 043 shipped: "i dont have colors or accent but i just want it to
be more professional beause will be coming to view my github since it is a
public repo, and i dont the sign or login so i dont know how it is working,
no menu in small screens and it is not mobile responsive."

Three things in there, and the first one was a surprise: "no menu in small
screens" was not a restatement of Experiment 042's already-fixed mobile work —
it was a NEW regression, introduced by 043 itself.

## What happened — checking the claim found a real bug I'd just shipped

`TopBar` held four things in one `justify-between` row: the wordmark, the nav
links, and — as of Experiment 043 — the theme `<select>`, plus the signed-in
user's name and sign-out button when auth is on. Nothing in that row wrapped
or collapsed. Measured directly at 375px: **440px of content in a 375px
viewport**, with the theme select clipped off the right edge and completely
unreachable — not degraded, gone. Adding the theme toggle is what tipped an
already-tight row into genuine overflow; Experiment 042's earlier mobile pass
happened before that toggle existed, so it never caught this.

## What We Built

| Piece | What it is |
| --- | --- |
| `components/mobile-menu.tsx` | A hamburger toggle below `sm:` (640px), inline nav above it — **one copy** of `NavLinks`/`ThemeToggle`/`CurrentUser`, passed in as `children` from the Server Component `TopBar`, not duplicated between a "mobile set" and a "desktop set". Two copies would mean two elements answering to `getByLabel("Theme")`, breaking `pnpm visual`'s existing locators and creating two sources of truth for one piece of state. |
| `components/shell.tsx` | `TopBar` now composes `<MobileMenu>{children}</MobileMenu>` instead of two separately-styled `<div>`s. |
| `docs/screenshots/*.png` | Real, current screenshots — light, dark, and the mobile menu open — embedded in the README itself, not just described. |
| `README.md` | A `## Screenshots` section, placed right after the intro, before the (long) Status list — the first thing a GitHub visitor sees is what the product looks like, not 40+ experiment bullets. |
| `scripts/visual.mts` | A new group: resizes to 375px mid-run, confirms zero horizontal overflow, confirms the theme select is unreachable BEFORE opening the menu and reachable AFTER — the exact regression, made permanent. |

## Important concepts

**A fix that isn't regression-tested is a fix that will regress again.**
Experiment 042 verified mobile behavior by hand and moved on; nothing kept
checking it as later experiments (043) touched the same header. The new
`pnpm visual` group exists specifically so the NEXT thing added to `TopBar`
gets caught the same way this one was — by running, not by someone
remembering to re-check by eye.

**"One copy, conditionally positioned" beats "two copies, conditionally
hidden" for responsive nav.** The tempting shortcut — render the nav twice,
`hidden sm:flex` on one, `sm:hidden` on the other — works visually and quietly
breaks anything that selects by label or role, because both copies exist in
the DOM regardless of which one is visible. `MobileMenu` takes `children`
once and lets Tailwind's responsive classes decide where that ONE copy is
positioned (inline in the row, or inside a toggled dropdown) — a real
constraint from having `pnpm visual`'s own locators to keep honest, not a
stylistic preference.

**"Not self-explanatory," revisited.** 042 answered this for the login
screen's own text. This round's version of the complaint — "i dont know how
it is working" — was about the REPO, not the running app: a public GitHub
README with zero images asks a visitor to imagine the product from prose
alone. Screenshots are the direct fix; screenshots of the actual current
UI (not mockups) are the honest one.

## Verified live

Same environmental constraint as 042/043 — Isaac's own `pnpm dev` was still
holding the project's Next.js dev lock, so `pnpm check`'s `e2e`/`visual`
gates could not spawn their own server. Checked by hand against that same
server, at 320px, 375px and 414px:

```text
before this fix:  375px viewport, 440px of content, theme select clipped off-screen
after this fix:   scrollWidth === clientWidth at 320 / 375 / 414px, every width
                   menu button: 44x44 (the same tap-target minimum as everything else)
                   closed: only the wordmark and hamburger show
                   open:   Notebook, Observability and the theme select all reachable
desktop (1280px):  hamburger hidden, theme select inline, exactly as before 043
```

`types`, `lint` (including the SAME `react-hooks/set-state-in-effect` rule
Experiment 043 hit — the "close on navigation" effect needed the same
render-time-adjustment rewrite, not a second exemption) were run directly and
are clean.

## Decisions

**Close-on-navigate computed during render, not in a `useEffect`.** Same
resolution as Experiment 043's theme-toggle rewrite, same reason: React's own
guidance (and this project's lint config enforcing it) is to compare the
previous and current value of what changed DURING RENDER and call `setState`
conditionally there, not synchronously inside an effect body. Two unrelated
components hitting the identical lint rule in two experiments in a row is a
signal this project's dependencies (React 19, this eslint config) expect this
pattern by default now, not an edge case to work around each time.

**No backdrop / click-outside-to-close.** The menu closes on Escape and on
navigating to a new page — judged sufficient for a two-item nav plus two
controls. A backdrop is a reasonable future addition if the menu ever grows
more content, not required to fix "no menu in small screens."

**Screenshots committed to `docs/screenshots/`, not the gitignored
`/screenshots/` `pnpm visual` writes to.** That directory is explicitly
scratch — regenerated, never meant to be reviewed as a diff. README imagery
needs to be intentional and stable, so it lives somewhere a `pnpm visual` run
does not silently overwrite it.

## Not verified

- **`pnpm check`'s `e2e`/`visual` gates**, specifically — the same queued
  item as Experiments 042 and 043, for the same reason.
- **A login-screen screenshot.** Isaac's dev server runs with no `APP_SECRET`
  (open, dev mode) — there is no lock screen to capture without either a
  spawned server (blocked by the same dev-lock conflict) or asking to pause
  the running one. The README's Screenshots section currently shows the
  authenticated shell and mobile menu only; adding the lock screen is a small
  follow-up once that's unblocked.

## Status

| Piece | State |
| --- | --- |
| Mobile top-bar overflow (the actual regression) | ✅ Fixed and verified live at 320/375/414px |
| Desktop layout unaffected | ✅ Verified live at 1280px |
| Regression coverage in `pnpm visual` | ✅ Written; not yet run through `pnpm check` (queued) |
| README screenshots (light, dark, mobile menu) | ✅ Shipped, real and current |
| README login screenshot | ❌ Not yet — see Not verified |
| `types` / `lint` | ✅ Clean |

## Next Step

Re-run `pnpm check` in full, and add the login screenshot, once a dev server
isn't holding the project's lock — three experiments' worth of `e2e`/`visual`
verification (042, 043, 044) all queue behind the same conflict.
