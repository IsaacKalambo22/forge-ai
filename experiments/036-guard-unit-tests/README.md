# Experiment 036 — Testing the Boundary Itself

## Objective

`src/lib/guard.ts` is named, in its own module-level comments and in
`docs/ARCHITECTURE.md`, as the thing every route calls before doing any work: auth,
rate limiting, budget. It had no unit test file. Given the project's own testing
philosophy — "pure modules with no imports... carry the logic worth testing
exhaustively" — the single most security-relevant module in the codebase was the
one place that philosophy hadn't reached yet.

## What happened — finding out WHY, not just that

Every other stateful module (`users.ts`, `usage.ts`, `revocation.ts`) splits into a
pure function taking an explicit `DatabaseSync` and a thin singleton wrapper
(`export const users = { byId: (id) => findById(db(), id), ... }`). Their test files
all call the pure functions directly with `openDatabase(":memory:")`, never touching
the singleton.

`guard.ts` doesn't have that split. `checkAuth()`, `checkBudget()`, `budgetStatus()`,
`currentUserId()` all call the SINGLETON wrappers directly — `users.ensureDev()`,
`usage.spentTotal()`, `revocations.isRevoked()` — with no way to hand them an
isolated database. That is the actual, mechanical reason no test file existed: doing
so honestly meant either touching the real `.data/forge.db` (which every other test
file goes out of its way to avoid) or refactoring `guard.ts`'s public signature to
accept a database parameter everywhere it's called — seven route handlers' worth of
call sites, for one module's tests.

Reading `src/lib/db.ts` found the smaller fix already half-built: `db()`'s singleton
reads `FORGE_DB_PATH` exactly once, at module load — `scripts/e2e.mts` already uses
this to give its spawned server a private database. The same trick works for the
in-process unit test run: set `FORGE_DB_PATH` before any test file is imported
(`tests/run.mts`, before the discovery loop), and every singleton call anywhere in
the test process — this file's, and any future one — gets an isolated `:memory:`
database, for free, with zero changes to `guard.ts` itself.

## What We Built

| File | What it is |
| --- | --- |
| `tests/run.mts` | `process.env.FORGE_DB_PATH ??= ":memory:"`, set before the test-file discovery loop. Two lines; unlocks the singleton path for testing without touching it. |
| `tests/guard.test.mts` | 44 assertions covering every branch `checkAuth()`/`checkBudget()` has: dev-open, prod-fail-closed, Bearer token (correct/wrong/wrong-length), session cookie (valid/bad-signature/revoked/missing), free routes bypassing budget entirely, per-user budget exceeded, total budget exceeded (even for a caller who has personally spent nothing), and the composition order in `guard()` — an auth failure wins over an exhausted budget, not the other way round. |

Test suite: **778 → 822 assertions.** New runtime dependencies: **none.**

## Important concepts

**A missing test file is sometimes a symptom, not an oversight.** The instinct on
finding this gap was to just start writing tests and hit the FOREIGN KEY error
immediately — `usage`'s `user_id` column requires the id to exist in `users`,
which the session-cookie auth path itself does NOT require (it trusts a valid
signature with no DB lookup at all). Tracing that back to guard.ts's coupling to
the singleton, rather than to an injectable function, is what explained why this
particular module was skipped while its neighbors weren't.

**Fixing testability and fixing the code are sometimes different-sized problems.**
Refactoring `guard.ts` to accept an injected database would have been the
"complete" fix, matching every other module's shape — and would have meant
touching every one of its callers for a benefit only tests need. Setting one env
var before the test process's module graph is built gets the same practical
outcome (a real, isolated database) without moving a single line of production code.

**Global mutable state (env vars, module singletons) needs an explicit restore
discipline in tests, not just a setup.** `withEnv()` in the new test file snapshots
and restores exactly the keys it touches, because `process.env` and `db.ts`'s
`instance` are shared with every test file that runs after this one in the same
process (`tests/run.mts` imports them all into one process, deliberately, so one
exit code says whether the whole project is sound).

## Decisions

**Real users, not arbitrary UUIDs, for the budget scenarios.** The session-cookie
auth path trusts a signed claim with no existence check — so an arbitrary
`randomUUID()` is a perfectly valid signed-in identity for testing `checkAuth()`.
`recordUsage()` disagreed: its FOREIGN KEY needs a real row. Rather than work around
that (a fake user with a matching id inserted by hand, bypassing `createUser()`),
the budget-testing groups create real users through the same function production
code uses — the test exercises the actual constraint instead of quietly avoiding it.

**`:memory:`, not a temp file.** `db.test.mts`/`usage.test.mts`/`users.test.mts`
already establish `:memory:` as this project's convention for an isolated test
database; matching it means one fewer thing to explain, and no temp file to clean up
after a run.

**One shared in-memory database for the whole file, not one per group.** Every
other DB-touching test file calls `openDatabase(":memory:")` fresh per scenario
(a new, empty database each time) — `guard.test.mts` can't do that, because it goes
through the SINGLETON (`db()`), which is one connection for the whole process by
design. Each group therefore uses a fresh, unique user id (`realUser()`,
`randomUUID()`) so scenarios stay independent from each other despite sharing the
underlying database — verified explicitly in the "total daily budget exceeded"
group, where accumulated spend from EARLIER groups is exactly what makes the total
ceiling trip.

## Not verified

- **Rate-limiter bucket state was reasoned about, not independently stress-tested.**
  `guard()` also consumes from `rateLimit()`'s in-memory buckets (20 per caller, 200
  global) on every call that passes auth — including calls that then fail on
  budget. The test file was written keeping per-identity and total call counts well
  under those capacities (counted by hand while writing it), rather than by adding
  an assertion that would fail loudly if a future edit made it call `guard()` many
  more times per identity. Worth a comment or a guard if this file grows.

## Status

| Piece | State |
| --- | --- |
| `FORGE_DB_PATH` set before test discovery | ✅ Verified (`pnpm check`, e2e's own separate `FORGE_DB_PATH` confirmed unaffected) |
| `checkAuth()` — dev-open / prod-closed / Bearer / cookie, all branches | ✅ Verified (22 assertions) |
| `checkBudget()` — free-route bypass, per-user, total, ordering vs. auth | ✅ Verified (13 assertions) |
| `budgetStatus()` | ✅ Verified |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

No queued item. The two previously-recorded open gaps (generation-phase latency,
blocked on the credential; the instrumentation/route `indexBuilt` cross-layer split,
cosmetic) are unchanged by this experiment.
