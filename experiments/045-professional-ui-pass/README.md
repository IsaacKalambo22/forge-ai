# Experiment 045 — A Professional UI Pass

## Objective

Isaac, framing this as a priority shift ahead of the next caching experiment: ForgeAI
is a public repo and part of a professional portfolio, so the UI needs to read as a
deliberately designed product, not a pile of experiments. Two concrete complaints
anchored it: the theme switcher should use recognizable icons (Sun/Moon/Monitor), not
a text dropdown, and — more pointedly — "I specifically noticed login-related files
that I don't see represented in the actual UI." The instruction was explicit: audit
first, don't invent a new auth flow if one already exists, determine whether the gap
is intentional, incomplete, or just undiscoverable before touching anything.

## What happened — the "missing" login turned out to be the opposite

An audit (routes, `src/lib/guard.ts`, `src/lib/session.ts`, `src/lib/users.ts`,
`layout.tsx`, `login.tsx`, `shell.tsx`) found a complete, non-scaffold auth system:
SQLite-backed users, scrypt password hashing, HMAC-signed sessions, a revocation
denylist, rate limiting — nothing mocked, no TODOs. It isn't under-exposed. It's
maximally exposed: `layout.tsx` checks `authRequired() && !hasValidSession()` and, if
true, replaces the **entire app** — `TopBar`, nav, everything — with a full-page lock
screen holding the login form. There is no separate `/login` route because a
signed-out visitor cannot reach anything else to link one from.

The actual explanation for "I don't see it": `.env.local` has no `APP_SECRET`, so
`guard.ts` fails open to a fixed dev user in local `pnpm dev` — the lock screen never
renders in Isaac's own dev environment. Experiment 044's own README already named this
exact gap in its Not-verified section: *"a login-screen screenshot… there is no lock
screen to capture without either a spawned server… or asking to pause the running
one."* That blocker was a stale dev-server lock, not a design problem — no forge-ai
process was running this session, so `pnpm visual` could finally drive it end to end.

Along the way, every existing screenshot in `docs/screenshots/` turned out to have a
small circular "N" badge in the bottom-left corner — Next.js 16's dev-mode route
indicator (`devIndicators`, on by default). It is real in every `pnpm dev` session and
in every prior screenshot, but it is not part of the shipped app: it does not render
under `next build && next start`. Left on, it would show up in a live local demo too,
not just a screenshot.

## What We Built

| Piece | What it is |
| --- | --- |
| `src/components/theme-toggle.tsx` | Rebuilt from a text `<select>` to a `role="group"` of three icon toggle buttons (Monitor/Sun/Moon), each with `aria-pressed`, `aria-label`, and `title`. Hand-drawn inline SVGs, matching the existing hamburger/X icon convention in `mobile-menu.tsx` — no icon library added for three glyphs. The state logic (`useSyncExternalStore`, localStorage, the same-tab custom event) is untouched; only the markup layer changed, because a `<select>`'s `<option>` cannot hold an `<svg>` — this was a real component swap, not a CSS skin. |
| `scripts/visual.mts` | Locators moved with the component: `getByLabel("Theme").selectOption(...)` (only valid on a `<select>`) became `getByRole("group", { name: "Theme" })` / `getByRole("button", { name: "Dark theme" })...click()`. Added two new assertions (the group is visible signed-out; the pressed button reflects `aria-pressed`) and a new dark-mode capture of the authenticated shell, mirroring the existing light/dark login capture. |
| `next.config.ts` | `devIndicators: false` — the dev-only route badge found in every prior screenshot. |
| `docs/screenshots/login-light.png`, `login-dark.png` | New. The lock screen, captured through the real form via `pnpm visual`, not staged. |
| `docs/screenshots/home-light.png`, `home-dark.png`, `mobile-menu.png` | Refreshed — new icon toggle, badge gone. |
| `README.md` | Screenshots section gained a Sign-in row (with a caption explaining why there's no `/login` URL), the dark-home caption now credits the icon toggle, and the Status/Experiments table/top status line were updated for this entry. |

## Important concepts

**"Discoverable" was the wrong axis to worry about — this flow is maximally
discoverable.** A hidden feature and a feature that gates literally everything else
look identical from "I don't see it in the UI" if the person looking has an
environment that happens to bypass the gate. The fix here wasn't UI work at all; it
was tracing *why* the dev environment disagreed with what production actually does,
and then giving the thing a screenshot so the README stops making a visitor guess.

**An icon requirement can force a real component change, not a restyle.** The
instinct for "make the theme switcher use icons" is to reach for CSS on the existing
`<select>`. Native `<option>` elements are text-only — there is no CSS path to an SVG
inside one. The honest fix is a different control (a button group), which is why this
touched `scripts/visual.mts`'s locators and not just a class name.

**A screenshot documents the deployed app, not the tool that built it.** The dev
indicator badge is genuine — it really renders, every time, under `next dev` — but
it's exactly the kind of accurate-yet-misleading capture the audit was watching for:
technically what the browser showed, not what a production visitor would ever see.
Turning it off is a one-line config change with no runtime effect on the app itself.

## Verified live

```bash
pnpm check
```

```text
  ✓ types    10.2s
  ✓ lint     12.1s
  ✓ test      5.1s   (unit — unchanged by this pass)
  ✓ e2e      15.6s   (unchanged by this pass)
  ✓ eval      1.5s   (unchanged by this pass)
  ✓ visual   17.8s   21 assertions, up from 12 (this pass added 2; the rest
                      were already there from 041/043/044, running for the
                      first time this session because no forge-ai dev server
                      was holding the lock)
  — verify   skipped: no ANTHROPIC_API_KEY
  all gates passed
```

Manually reviewed all five promoted screenshots at their captured sizes (1280px
desktop for login/home, 375px for the mobile menu) in both themes — no dev badge, no
horizontal overflow, the icon toggle's active state visibly distinct (filled
background) from the other two buttons in both themes.

## Decisions

**`role="group"` + `aria-pressed`, not `role="radiogroup"` + `role="radio"`.** A true
ARIA radio group requires roving-tabindex arrow-key navigation to be correct; three
independently-tabbable toggle buttons are simpler and just as usable for three items,
and nothing about "System/Light/Dark" benefits from radio semantics specifically.

**No icon library added.** `lucide-react` or similar would be the default reach, but
the codebase's only existing icons (`mobile-menu.tsx`'s hamburger/X) are hand-drawn
inline SVG, and three more tiny glyphs don't justify a new dependency in a project
that otherwise has zero UI-library dependencies by design.

**No new `/login` route, no duplicate auth screen.** The brief was explicit not to
invent a flow that already exists. The existing full-page gate already satisfies
"the user can discover and reach it" — building a second entry point would just
create two sources of truth for signed-out state.

**`Skeleton` (in `src/components/ui.tsx`) left as-is.** The audit found it defined
and genuinely unused everywhere — the app uses text-only loading labels
("Signing in…", "Thinking…") instead. Left unchanged rather than force-adopting it
somewhere just to make it reachable, or deleting it unasked; noted here for Isaac to
decide.

**Screenshots promoted to `docs/screenshots/`, not committed from the gitignored
`/screenshots/` `pnpm visual` writes to** — same convention Experiment 044
established; that directory is scratch, regenerated every run.

## Not verified

- **Production-mode (`next build && next start`) screenshots.** `pnpm visual` always
  drives `next dev`; `devIndicators: false` removes the one piece of dev-only chrome
  that would otherwise leak into a screenshot, but no separate production-mode capture
  was taken to independently confirm visual parity.
- **`ANTHROPIC_API_KEY`-gated behavior** — unaffected by this pass, still the
  pre-existing blocked state; see [Experiment 020](../020-verification-debt/README.md).

## Status

| Piece | State |
| --- | --- |
| Icon theme toggle (Monitor/Sun/Moon) | ✅ Shipped, `pnpm visual` 21/21 including 2 new assertions |
| Sign-in flow investigated | ✅ Confirmed complete and maximally discoverable — not a gap to fix |
| Sign-in screenshots (light + dark) | ✅ Shipped, real captures via the actual form |
| Dev-mode indicator badge | ✅ Found in every prior screenshot, disabled (`devIndicators: false`) |
| README screenshots gallery | ✅ Sign-in row added, home/mobile shots refreshed |
| `pnpm check` (full gate) | ✅ All 6 runnable gates green; `verify` skipped (no credential, pre-existing) |

## Next Step

Prefix caching (`/api/chat`), the work this pass paused — see the Deferred section of
the root README.
