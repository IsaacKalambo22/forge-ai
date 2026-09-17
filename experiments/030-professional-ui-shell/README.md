# Experiment 030 — Professional UI Shell

## Objective

Every screen so far has been two client components stacked on one route, styled
inline, with no shared visual language. A separate directive asked for the UI to
read as production software rather than a demo. It described an event-ticketing
product (organizer dashboard, scanner, checkout) — none of which exists here; this
is a chat/RAG/agent learning project. Applying the directive meant taking its
underlying standard (design system, real data only, deliberate states, accessible
markup) and pointing it at ForgeAI's actual surfaces instead of an imagined domain.

## What happened

Inspected the existing UI before touching it: one route (`/`), a server-side auth
gate in `page.tsx`, `Chat` and `Ask` as inline-styled client components, `globals.css`
carrying two color tokens and a dead `font-family: Arial` override (Geist was loaded
but never applied — the CSS variable was defined and unused). No component layer, no
navigation, no second route despite `GET /api/metrics` already returning real
operational data nothing rendered.

## What We Built

| Piece | What it is |
| --- | --- |
| `src/app/globals.css` | Semantic color tokens (`--surface`, `--border`, `--muted-foreground`, `--success`/`--warning`/`--destructive`/`--info` + `-bg`/`-border` pairs), light/dark via existing `prefers-color-scheme` block. Fixed the dead `font-family` line to reference `--font-sans`. |
| `src/components/ui.tsx` | The primitives actually reused more than twice: `Button`, `Input`, `Select`, `Label`, `PageHeader`, `SectionHeading`, `EmptyState`, `ErrorState`, `Badge`, `Skeleton`. |
| `src/components/shell.tsx` | `TopBar` (Server Component: resolves the signed-in username from the session cookie via `currentUserId` + `users.byId`, same functions `guard()` already uses) and `PageContainer` (consistent max-width/padding). |
| `src/components/nav-links.tsx` | Client Component nav — needs `usePathname` for the active-route state, which is why it's split out from the otherwise-server `TopBar`. |
| `src/app/layout.tsx` | Moved the lock check (`authRequired() && !hasValidSession()`) here from `page.tsx`, so it applies to every route once instead of being re-derived per page. Locked → centered `Login`, no chrome. Unlocked → `TopBar` + `PageContainer`. |
| `src/app/metrics/page.tsx` | New route. A Server Component that calls `currentSnapshot()`, `budgetStatus()`, `usage.byRoute()`, `indexReady()`, `embedCache.count()` directly — the same functions `GET /api/metrics` calls, not a `fetch()` of the route itself. Renders budget, index health, and a per-route latency/error/spend table, with a real empty state when no requests have landed yet. |
| `src/app/{chat,ask,login}.tsx` | Re-skinned onto the token system and shared primitives. Logic untouched — same NDJSON handling, same state machine, same validation. |

## Decisions

**The lock check moved to `layout.tsx`, not duplicated per page.** `/metrics` needed
the same gate `/` already had. Re-deriving `authRequired() && !hasValidSession()` in a
second page would have been the first instance of exactly the duplicated logic the
directive said to avoid. One check, at the root, and new routes get it for free.

**`/metrics` reads the metrics *functions*, not the metrics *route*.** Fetching
`/api/metrics` from a Server Component would mean the server calling itself over
HTTP for data it already has in-process — an extra network hop, an extra pass through
`guard()`'s rate limiter for a page load (not an API call), and a second place that
could disagree with the first about what "current" means. Importing `currentSnapshot`,
`budgetStatus`, etc. directly keeps exactly one implementation of "what is currently
true," which the route and the page both call.

**No fabricated metrics.** A fresh server has an empty `snapshot.routes` — the page
shows "No requests recorded yet," not a placeholder count. `spendByRoute[route]` is
`undefined` until a route has spent something; the table falls back to `$0` rather
than crashing on a missing key.

**Server Component vs Client Component, concretely.** `TopBar` needs the session
cookie (server-only: `headers()`) but `NavLinks` needs to know the current path to
highlight the active link (client-only: `usePathname`), so one shell splits into two
files at that exact boundary rather than making the whole bar a Client Component and
re-fetching identity through an API call it doesn't need.

## Questions

- The event-ticketing directive that prompted this still doesn't match this
  project. If it was meant for a different repo, that mismatch is worth resolving
  before another one arrives shaped the same way.
- `/metrics` has no pagination or time-range control — it always shows the same
  window `currentSnapshot()` and `usage.byRoute()` already use server-side. Fine at
  current traffic; would need a real query parameter once the window matters.

## Status

| Piece | State |
| --- | --- |
| Design tokens (`globals.css`) | ✅ Verified (`pnpm check`, visual smoke test) |
| Shared primitives (`components/ui.tsx`) | ✅ Verified |
| App shell — `TopBar`, `PageContainer`, root-layout auth gate | ✅ Verified |
| `/metrics` — real data, real empty state | ✅ Verified |
| `Chat` / `Ask` / `Login` re-skinned, logic unchanged | ✅ Verified |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |
| Manual smoke test (dev server + curl, both routes) | ✅ No server errors, expected content present |

## Next Step

No browser-automation tooling (`chromium-cli`, Playwright) is available in this
environment, so verification here was `curl` against rendered HTML plus `pnpm check`
— not a visual screenshot. Worth running `/run-skill-generator` or installing a
headless-browser driver before the next UI slice, so future changes get an actual
pixel check instead of a markup check.
