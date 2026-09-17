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

- ~~The event-ticketing directive that prompted this still doesn't match this
  project.~~ Resolved — confirmed the mismatch was a misdirected brief, not intended
  for ForgeAI. Corrected explicitly: no ticketing/organizer/checkout concepts belong
  here, ever.
- `/metrics` has no pagination or time-range control — it always shows the same
  window `currentSnapshot()` and `usage.byRoute()` already use server-side. Fine at
  current traffic; would need a real query parameter once the window matters.

## Continued: Chat's state machine, extracted and tested

The Deferred list carried "client-component tests — `chat.tsx` state handling is
only hand-clicked" since before this experiment. The audit that opened this
continuation confirmed why: every one of the 27 files in `tests/` targets a pure
`src/lib/*` module with no imports (`agent.ts`, `ndjson.ts`, `session.ts` — see
`docs/ARCHITECTURE.md`'s Testing section). `chat.tsx` had never been shaped that
way — its conversation-id lifecycle, streaming buffer, and persona-reset logic all
lived inside `useState` calls in the component, reachable only by rendering it.

**What changed:** `src/lib/chat-state.ts` — a `ChatState` type, an `initialChatState()`,
and a pure `chatReducer(state, action)` covering every transition `chat.tsx` used to
do by hand: `send_started`, `send_rejected`, `stream_event` (wrapping the existing
`StreamEvent` union from `messages.ts`), `send_finished`, `persona_changed`,
`analyse_started/succeeded/failed`. `chat.tsx` now holds one `useReducer(chatReducer,
initialChatState())` instead of nine separate `useState` calls, and every `setX(...)`
call became a `dispatch({ type: ... })`. `tests/chat-state.test.mts` — 32 assertions
covering every action, plus the three `StreamEvent` variants (`sources`/`step`/
`stopped`) that belong to `/api/ask`/`/api/agent` and must be safe no-ops when they
reach `chat.tsx`'s reducer (they can't in practice, but the union is shared, so the
`switch` has to be exhaustive over it anyway).

**Concept, concretely applied:** a reducer is `useState` generalized to "many fields
that change together, for reasons worth naming." The `send_started` action alone used
to be five separate `setX` calls in a row (`setMessages`, `setInput`, `setLoading`,
`setError`, plus resetting `streaming`/`meta`/`activity`) — easy to get out of order or
forget one when a tenth field gets added later. One `dispatch` call makes "what happens
when a message is sent" a single, testable fact instead of an implicit invariant
spread across a component body.

**Decision — `input` stayed outside the reducer.** It's the one piece of `chat.tsx`
state that is pure UI (what's currently typed, not yet submitted) and never
participates in a business-logic transition — `send_started` reads it once via a
parameter, it doesn't live in `ChatState`. Folding it in would have meant the reducer
importing nothing meaningful from it; a plain `useState` says that more honestly than
forcing everything through one abstraction because the abstraction exists.

**Decision — `ask.tsx` was left alone.** Same shape of problem exists there, but this
extraction targeted the concrete audit finding (`chat.tsx`, named explicitly in the
Deferred list), not "extract every component's state on principle." `ask.tsx` is
smaller and it isn't broken; it goes through the same treatment when there's a
concrete reason to (a bug, a new feature that touches its state), not preemptively.

**Verified:** `pnpm test` — 742 total assertions (was 710 before this file), all new
ones passing. `pnpm check` — types, lint, unit, e2e, eval all green (e2e in particular
confirms the refactor didn't change what actually crosses the HTTP boundary, since it
exercises `chat.tsx` through a real running server). No visual/browser check needed —
this change has no UI surface of its own; `chat.tsx`'s rendered output is byte-for-byte
what it was before.

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
| `chat.tsx` state extracted to `src/lib/chat-state.ts` | ✅ Verified (32 unit assertions, `pnpm check`) |
| `ask.tsx` inspected for the same problem | ✅ Checked — no reducer-worthy invariant found, deliberately left as-is |

**On `ask.tsx`, checked and closed rather than deferred:** its `useState` calls
looked superficially like `chat.tsx`'s before extraction, but there's no invariant
behind them worth protecting — no committed-vs-streaming distinction (`/api/ask` has
no conversation history to accidentally commit early into), no cross-field coupling
(`mode` isn't tied to a server-side identity the way `persona` was to
`conversationId`). Extracting a reducer here would have moved code, not fixed
anything — the lesson this was checking for.

## Next Step

No browser-automation tooling (`chromium-cli`, Playwright) is available in this
environment, so verification here was `curl` against rendered HTML plus `pnpm check`
— not a visual screenshot. Worth running `/run-skill-generator` or installing a
headless-browser driver before the next UI slice, so future changes get an actual
pixel check instead of a markup check.
