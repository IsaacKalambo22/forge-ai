# Experiment 033 — /metrics Time Range, and a Deeper Bug It Uncovered

## Objective

Ship the gap Experiment 030 flagged in its own "Questions" section: `/metrics` had
no time-range control on spend — it always showed whatever `usage.byRoute()`'s
default (24h) happened to be. Small, well-scoped, buildable without a credential.

## What happened — the small feature, then a much bigger finding

`usage.byRoute(sinceMs)` already took a window parameter (Experiment 017); only the
UI never exposed it. Added a whitelisted `?window=1h|24h|7d` (`src/lib/metrics-windows.ts`,
shared between the page and `GET /api/metrics` so the two can't validate it
differently), and a small link-based picker — no client JS needed, since Server
Components already read `searchParams`.

**While smoke-testing it against a real running server**, not just checking the
markup contained the right words, a discrepancy showed up: `GET /api/metrics`
reported growing request counts as I hit `/api/search` repeatedly, but the `/metrics`
*page*, reading the exact same `currentSnapshot()` function, stayed at
`{ total: 0, window: 0 }` no matter how much traffic there was. Same function,
same process, different answer.

**Root cause, confirmed by direct testing, not assumed:** `src/lib/telemetry.ts`'s
request buffer is a module-level `let current = newBuffer()`. Next.js bundles a
Server Component page and a Route Handler that both import the same source file
into **separate module instances**, one per rendering "layer" (`rsc` vs `route`).
Each layer gets its own copy of that `let`. `/api/metrics` (a Route Handler) was
reading the copy every real API call actually writes to; `/metrics` (a Server
Component) was reading an isolated copy that starts empty and, calling
`currentSnapshot()` directly, can never receive anything.

`src/lib/knowledge.ts`'s `indexBuilt` flag is the same shape of module-level `let`
— checking it turned up the same bug a second time, and then a third, larger one:

**`instrumentation.ts`'s boot-time warm-up (Experiment 025) writes to yet a third,
separate module instance of `knowledge.ts` — the "instrumentation" layer's copy —
which no Route Handler ever reads.** Confirmed on a fresh dev server: the log shows
`"notebook index ready"` once at boot (instrumentation's own build completing), and
then a **second** `"notebook index ready"` line, 312ms later, the moment the first
real `POST /api/ask` request arrived — because `/api/ask`'s Route Handler checked
`indexReady()` on **its own** copy of `indexBuilt`, found it `false`, returned 503,
and (per `knowledge.ts`'s comment: *"a route can now kick the build off and return
503... instead"*) kicked off its own build in the route layer. The boot warm-up ran
— for a copy of the flag nothing else can see.

**This means Experiment 025, as shipped, provides no benefit to a real first
request.** Its own status table already hedged this precisely: "Boot-time warm-up |
✅ **Built**" — not "Verified", unlike every neighboring row. `pnpm warm`'s 82.8s→36ms
measurement is real, but it measures a standalone script running outside Next's
layered bundling entirely — it never exercised the boundary that breaks this.

## What We Built (this experiment's actual scope)

| File | What it is |
| --- | --- |
| `src/lib/metrics-windows.ts` | `SPEND_WINDOWS`, `parseSpendWindow()` — the whitelist, shared so the page and the API route validate `?window=` identically. |
| `src/app/api/metrics/route.ts` | Accepts `?window=`, returns `spend_window` and `spend` (renamed from `spend_24h`, since it's no longer fixed) alongside the existing fields. |
| `src/app/metrics/page.tsx` | **Rewritten to fetch its own `/api/metrics` route internally** rather than calling `currentSnapshot()` / `indexReady()` / `budgetStatus()` / `usage.byRoute()` directly — the fix for the layer-isolation bug, not just the time-range feature. Forwards the request's `cookie` header (so `guard()` sees the same session) and the `?window=` query param. `budgetStatus()`/`usage.byRoute()`/`embedCache.count()` never had this problem (SQLite-backed, not module state) but are now read the same way for one consistent code path instead of two. |

This experiment does **not** fix the deeper instrumentation/route warm-up gap — see
Decisions, below.

## Important concepts

**A "singleton" module isn't always a singleton.** `let x = ...` at module scope is
one instance *within a module graph*. Next.js's bundler deliberately builds separate
graphs per rendering layer (Server Components, Route Handlers, instrumentation) so
that, e.g., server-only code never leaks into a client bundle. The tradeoff, not
documented anywhere prominent: in-memory state does not cross that boundary either,
silently. `src/lib/db.ts` and `src/lib/usage.ts` never hit this because a SQLite
file is not a JS module-scope value — every layer that calls `db()` opens the same
file and sees the same rows.

**Measured, not assumed — twice in one session.** The instinct on finding the
telemetry bug was "that probably also affects `indexReady()`" — checked directly
rather than trusted, and it did, and checking *that* is what surfaced the
instrumentation gap. The habit that mattered here wasn't cleverness, it was refusing
to accept a plausible guess as confirmation once one instance of the bug was found.

## Decisions

**Fixed the two bugs this experiment's own scope touched (`/metrics` page); did not
fix the instrumentation/route warm-up gap.** That fix is a different, larger
question — does `indexBuilt` move to something layer-independent (a file flag, like
`embedCache`? a SQLite row?), or does `instrumentation.ts`'s warm-up become
reachable from the route layer some other way? Either is a real design decision
about Experiment 025's architecture, not a "smallest correct change" — flagged for
the next experiment rather than decided under this one's scope.

**`/metrics` now costs one extra internal HTTP hop.** Experiment 030 explicitly
chose to call the underlying functions directly specifically to avoid this hop. That
reasoning was correct for `budgetStatus()`/`usage.byRoute()`/`embedCache.count()`
and wrong for `currentSnapshot()`/`indexReady()` — and there was no way to know
which without hitting the actual bug. Given the split is real, fetching the route
for everything (rather than half-direct, half-fetched) is the simpler, single-path
option, and correctness beats one saved hop on an operator-facing page that is
never on a hot path.

## Not verified

- **Whether the same layer-instance split happens in a production build
  (`next build && next start`).** The dev-mode reproduction here is direct and
  repeated. Testing the identical scenario against `next start` was attempted but
  blocked on `APP_SECRET`-gated auth setup within this session's time budget — not
  skipped by choice. Next.js's layer separation is a bundler-level design, so there
  is good reason to expect it applies in production too, but "good reason to expect"
  is not the same status as the dev-mode finding, which was actually reproduced.
- **Whether `/api/agent` has the same cold-503-then-rebuild behavior as `/api/ask`.**
  Not tested directly this session; it imports from the same `knowledge.ts` and
  almost certainly does, by the same mechanism, but that's inference, not a repro.

## Status

| Piece | State |
| --- | --- |
| `?window=` on `/api/metrics` and `/metrics` | ✅ Verified (dev server, all three windows, invalid input falls back to 24h) |
| `/metrics` reads telemetry/index state correctly (was always 0/"Building") | ✅ Verified — fixed and reproduced fixed, on a live server |
| Instrumentation warm-up not reaching the route layer | 🔴 **Found, not fixed** — real gap in Experiment 025, scoped out of this one |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

This is a genuine fork, not a forced next step — flagging rather than choosing:

1. **Fix the instrumentation/route warm-up gap now**, as its own experiment (034) —
   the real product impact is that every real first `/api/ask` or `/api/agent`
   request pays the cold-build cost Experiment 025 was built specifically to avoid.
2. **Defer it**, recorded in README's Deferred list, and move to something else —
   it's a real cost regression but not a correctness bug (requests still succeed,
   just slower on the very first one per route layer, and layers don't respawn
   often in a single-process dev/staging setup).

No unit tests were added for `metrics-windows.ts` in this pass — its two pure
functions (`isSpendWindow`, `parseSpendWindow`) are simple enough to be covered by
the live-server verification above, and adding a test file for two one-line
predicates would be process without content. Worth a look if the whitelist grows
past three entries.
