# Experiment 037 — Closing the Ceiling's Lip

## Objective

`guard.ts`'s `checkBudget()` has carried the same honest limitation, stated in its own
comment, since Experiment 017:

> This authorizes a request on spending SO FAR, and the cost of the request being
> authorized is unknowable until it finishes. So the budget can always be exceeded by
> the cost of one in-flight request (or of several arriving together). It is a
> ceiling with a lip, not a hard cap.

README's Deferred list named the fix already: "Reservation-based hard budget cap —
today's check is a ceiling with a lip." Nothing about it depends on the Anthropic
credential — it is pure arithmetic and a database, the same shape as Experiment 036's
`guard.ts` work the session before this one.

## What happened — finding out WHY the fix has a natural size

The gap is a race: two requests read `usage.spentTotal()` before either has recorded
anything, so both see the same under-budget figure and both proceed. Closing it means
staking a claim BEFORE the model is called, not just accounting for the cost AFTER —
i.e. a reservation.

The natural question is what to reserve. Input tokens depend on retrieved passages and
conversation history — genuinely unknown at `guard()` time without re-deriving what
`ai.ts` is about to send, which `guard.ts` has no business doing. Output tokens are a
different story: every call site in `ai.ts` passes `max_tokens: 1024`, a real ceiling
fixed since Experiment 001. That is a number `checkBudget()` CAN reserve against — not
an estimate, a guarantee the API contract makes.

That constant existed only as six copies of the literal `1024` in `ai.ts`. A reservation
computed from a number that could silently drift out of sync with the real request
would be exactly the kind of guessing `pricing.ts`'s own header warns against
("money that cannot be checked by hand is money you are guessing at") — so it became
one named export, `MAX_OUTPUT_TOKENS` in `pricing.ts`, and all six call sites now read
from it instead of repeating the literal.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/pricing.ts` | `MAX_OUTPUT_TOKENS = 1024`, one source of truth for the ceiling every `ai.ts` call site already obeyed. |
| `src/lib/ai.ts` | Its six `max_tokens: 1024` literals now read `MAX_OUTPUT_TOKENS`. |
| `src/lib/db.ts` | Migration 7 — a `reservations` table: `request_id` (PK), `user_id` (FK), `route`, `amount_nanodollars`, `created_at`, `expires_at`. |
| `src/lib/reservation.ts` | New. `reserve` / `release` / `activeTotal` / `activeByUser` / `purgeExpired`, same injectable-`DatabaseSync`-plus-singleton-wrapper shape as `revocation.ts`. |
| `src/lib/guard.ts` | `guard()` and `checkBudget()` now take a `requestId`. `checkBudget()` computes `reservedCostFor(route) = COST[route] * MAX_OUTPUT_TOKENS * price.output`, folds `reservations.activeTotal()`/`activeByUser()` into both budget comparisons, and stakes the claim before returning success. `rateLimit()`'s existing 60s amortised cleanup now also calls `reservations.purge()`. |
| `src/app/api/{ask,agent,chat,analyze}/route.ts` | Each now releases its reservation in the one place every one of them already runs regardless of outcome — the streaming routes' `finally`, `analyze`'s new `finally` around its non-streaming call. |
| `src/app/api/{search,metrics,login}/route.ts` | Updated only for `guard()`'s new signature — `COST` is 0 for all three, so `checkBudget()` returns before any reservation logic runs. |
| `tests/reservation.test.mts` | New — the module's own contract: stake, sum (total and per-user), release (including releasing what was never reserved), idempotent double-reserve, expiry, purge, restart durability. Mirrors `revocation.test.mts`. |
| `tests/guard.test.mts` | Two existing session-cookie groups switched from an arbitrary `randomUUID()` to a real `realUser()` — `reservations.user_id` carries a genuine FOREIGN KEY, unlike the read-only checks `checkBudget()` used to make. Three new groups prove the actual fix: a second concurrent request is refused by the first's outstanding reservation with **zero** recorded spend on either side; releasing a claim frees the budget it held; a free route never stakes one. |

Test suite: **822 → 849 assertions.** New runtime dependencies: **none.**

## Important concepts

**A reservation only needs to bound the part of the cost that is genuinely unknown.**
Input tokens are also unbilled at authorization time, but they are not unknowable —
`ai.ts` is about to send exact text. Reserving only the output side is not a shortcut
around rigor; it is reserving exactly the quantity the API contract (`max_tokens`)
actually guarantees a ceiling for, stated as such rather than dressed up as a full
worst-case bound it is not.

**A reservation is not a ledger entry.** `usage` rows are permanent billing history;
`reservations` rows are working state that should almost always be gone within
seconds. Giving them separate tables, rather than an `is_reservation` flag on `usage`,
keeps the permanent ledger's meaning simple and makes the reservation table safe to
think about purely in terms of "what's outstanding right now" — the same category
split Experiment 025 already made for the embedding cache vs. application state.

**Short TTL as the failure-mode boundary, not a nicety.** A route that reaches its
`finally` releases its claim in milliseconds. A route that errors out BEFORE that —
a 400 on a too-long question, a 503 while the index warms — never explicitly releases
anything, and was a deliberate scope decision (below) rather than a bug. The
5-minute TTL is what turns that decision into a bounded, self-healing cost instead of
an unbounded one, the same trade `revoked_sessions` already makes for a stolen session.

**Inherited imprecision, not introduced.** `reservedCostFor()` reuses `COST[route]` as
the upstream-call count, same as `rateLimit()`'s existing weighting. `COST.chat` is 1
while `runToolLoop()` can actually take up to `MAX_TOOL_ITERATIONS` (5) turns — a gap
that predates this experiment and belongs to the rate limiter's own weighting, not to
the reservation built on top of it. Recorded here rather than silently inherited.

## Decisions

**Reserve once per route call, not once per upstream call.** `agent` can make up to
`COST.agent` (6) upstream calls in one request, each individually capped at
`MAX_OUTPUT_TOKENS`. Reserving the full `COST[route] * MAX_OUTPUT_TOKENS * price.output`
up front — one claim for the whole run — matches how `guard()` is actually called
(once, before the route's work starts) without needing `ai.ts` to know anything about
budgets.

**No explicit release on early-return paths (400/404/503 before the stream begins).**
Every one of the four paid routes validates the request body, resolves a conversation,
or waits on the index AFTER `guard()` has already staked a claim. Adding an explicit
release at each such return point across four files was the more "complete" shape —
and also the highest-risk change to routes whose comments already explain, line by
line, why status codes are ordered the way they are. The TTL (5 minutes) bounds the
cost of the simpler choice: an early validation failure holds its reservation for at
most that long, self-healing rather than leaking forever. Revisit if a route's
early-exit paths turn out to be hit often enough for that window to matter in practice.

**`budgetStatus()` (surfaced on `/metrics`) still reports recorded spend only, not
reservations.** Folding outstanding claims into "remaining" would make the operator
view more conservative and arguably more honest — deferred rather than bundled in,
since it is a display decision independent of the correctness fix and changes what an
existing, tested endpoint reports.

**Per-user budget, not the total, for the new race-condition tests.** `guard.test.mts`
shares one `:memory:` database across the whole file (Experiment 036's own finding);
by the time the new groups run, several earlier groups have already staked
reservations with a 5-minute TTL that outlives the entire test run. Scoping the new
assertions to a single fresh `realUser()`'s PER-USER budget isolates them from that
accumulated state the same way the existing per-user tests already do — the total-budget
path is still exercised, just by the pre-existing "total daily budget exceeded" group.

## Not verified

- **Real concurrency.** The new tests call `guard()` twice in sequence within one
  synchronous test, which exercises the same code path two truly-parallel requests
  would hit (SQLite's `INSERT ... ON CONFLICT` and the read-then-compare in
  `checkBudget()` are not wrapped in an explicit transaction), but does not prove
  there is no window between the SELECT sums and the INSERT under real concurrent
  load. `node:sqlite`'s synchronous API and Node's single-threaded execution make a
  same-process race narrower than it would be against a separate database server;
  not stress-tested here.
- **Whether the TTL is well-tuned against a live model call.** `RESERVATION_TTL_MS`
  (5 minutes) was sized by reasoning about `agent`'s worst case — up to 6 sequential
  calls, each bounded by `MAX_OUTPUT_TOKENS` — not by measuring a real run, which
  needs the credential this project still does not have.

## Status

| Piece | State |
| --- | --- |
| `MAX_OUTPUT_TOKENS` — one source of truth, `ai.ts`'s six call sites and `guard.ts`'s reservation both read it | ✅ Verified |
| `reservations` table + migration 7 | ✅ Verified (`db.test.mts`'s table listing, restart durability) |
| `reservation.ts` — reserve/release/sum/purge, idempotent, expiring | ✅ Verified (new `reservation.test.mts`) |
| `checkBudget()` counts outstanding reservations before authorizing | ✅ Verified — a second concurrent request is refused with $0 recorded spend on either side |
| All four paid routes release their claim in `finally` | ✅ Verified (`pnpm e2e`, unaffected — the release path executes on every request they already exercise) |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

No queued item. Same shape as 036's close: the generation-phase latency gap and the
`indexBuilt` cross-layer split are both unchanged by this experiment. `budgetStatus()`
reservation-awareness (Decisions, above) is the one new, explicitly-deferred thread
this experiment leaves behind.
