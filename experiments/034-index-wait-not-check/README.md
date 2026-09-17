# Experiment 034 — Wait for the Index, Don't Just Check It

## Objective

Experiment 033 found and left open: `instrumentation.ts`'s boot-time warm-up
(Experiment 025) writes to a module instance no Route Handler ever reads, so
`/api/ask` and `/api/agent` 503 on every route layer's first real request — the
exact cost 025 was built to remove, reintroduced by a boundary 025 didn't know
existed. Fix it.

## What happened — the question was wrong, not just the state

The instinct going in was to make `indexBuilt` cross-layer somehow — a shared file
flag, a database row, something `instrumentation.ts` and every Route Handler could
agree on. That's a real fix, and a bigger one: it changes what "ready" means for the
whole system, not just this bug.

Re-reading `knowledge.ts` first (per the standing rule: inspect before changing)
turned up a cheaper way in. `getIndex()` — the actual build — reads from
`embedCache`, a **file**, not a JS module value. `embedCache` genuinely IS shared
across every layer, unlike `indexBuilt`. So a route layer's own "first" build,
even though its own `indexBuilt` starts `false`, is a cache read: **measured at
51-312ms** across several fresh-server tests (033 and this session), not the 516s
cold-embed 024 exists to prevent.

The actual defect wasn't "the flag is wrong" — it's that `if (!indexReady())` asks
a yes/no question when the honest question has three answers: *ready now*, *ready
soon* (worth a short wait), or *actually not ready* (worth a 503). The old code
could only express the first and the third.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/once.ts` | `readyWithin(promise, timeoutMs)` — resolves `true` if `promise` settles first, `false` if the timeout wins. Does not cancel or restart `promise` either way. A rejection propagates as a rejection, not a timeout — "it broke" and "still running" are different things a caller needs to tell apart. |
| `src/lib/knowledge.ts` | `ensureIndexReady(timeoutMs = 3000)` — replaces the plain `indexReady()` boolean as the route-level gate. `indexReady()` itself is unchanged and still used by `/metrics`'s status badge, where a stale "Building" is cosmetic, not a failed request. |
| `src/app/api/ask/route.ts`, `src/app/api/agent/route.ts` | `if (!indexReady()) { warmIndex(); return 503; }` → `if (!(await ensureIndexReady())) return 503;`. `warmIndex()` is no longer called from here — `ensureIndexReady()` already starts/joins the build as part of racing it. |
| `tests/once.test.mts` | 7 new assertions on `readyWithin()`: resolves on early settle, resolves `false` on timeout, does **not** restart a `sharedRetryable` load a caller gave up on (the property that makes this safe to use here at all), propagates a real rejection distinctly from a timeout, and handles an already-settled promise. |

Test suite: **771 → 778 assertions.** New runtime dependencies: **none.**

## Important concepts

**A boolean is the wrong type for "not yet, but soon".** `indexReady()` could only
ever say `true` or `false`. The fix wasn't better state tracking — it was
recognizing the gate needed a third outcome (*wait a bit*) that no boolean can
express, and reaching for `Promise.race` against a timeout instead.

**Not cancelling is the whole safety property.** `readyWithin()` giving up on a
promise must not affect it. If it did, a caller that timed out would silently kill
the build for the next caller too — turning "the first request waits 3s and then
sees a 503" into "no request in this layer ever succeeds." The test that checks
this (`readyWithin()` does not cancel or restart the underlying work`) is the one
that actually matters here; the others just confirm the race resolves correctly.

**A file beats a module variable for anything that needs to survive a boundary.**
`embedCache`'s data survived the exact layer split that broke `indexBuilt`, for the
same reason `usage`/`db.ts` never had this problem in 033: a real file on disk
doesn't care which bundle asks to read it.

## Decisions

**Did not make `indexBuilt` cross-layer.** That's still open, and still a bigger
question than this experiment needed to answer — see 033's Decisions for why. This
fix works entirely by making the FIRST build in each layer cheap enough to just
wait for, using state (`embedCache`) that was already durable. It doesn't touch
whether `indexReady()` itself agrees across layers.

**3 seconds, not the request's full budget.** Measured rebuilds are 51-312ms with a
warm cache — 3s leaves roughly 10-50x margin for a slower disk or a larger corpus,
while still failing fast (not blocking a request for the platform's full timeout
budget) in the genuinely-cold case this is not meant to solve.

**`warmIndex()` kept, scope narrowed.** Still exported, still used by
`instrumentation.ts` at boot — starting the build early is still worth doing, since
it's what makes `embedCache` warm by the time a real request arrives in ANY layer.
It's just no longer what a route calls to decide whether to 503.

## Not verified

- **Whether 3000ms is right under real load**, as opposed to this session's mostly-idle
  local testing. A busier server or a much larger corpus could push a cache-hit
  rebuild closer to the timeout; there's no measurement of that here, only of the
  idle case.
- **Production (`next build && next start`).** Same gap 033 already recorded — dev-mode
  testing here was direct and repeated; production was not independently re-verified
  this session either.

## Status

| Piece | State |
| --- | --- |
| `readyWithin()` | ✅ Verified (7 unit assertions, including the no-cancel property) |
| `ensureIndexReady()` replaces `indexReady()` as the route gate | ✅ Verified |
| A fresh server's first `/api/ask` succeeds (not 503) | ✅ Verified — live dev server, 200 with real retrieved sources, failing only at the (expected, credential-less) model call |
| A fresh server's first `/api/agent` succeeds | ✅ Verified — live dev server, 200 |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

The instrumentation/route `indexBuilt` split itself is still open — recorded, not
reopened here. Otherwise: no new credential-free thread queued. Same fork as before
033: another measurable-without-credential engineering gap, or UI-facing work.
