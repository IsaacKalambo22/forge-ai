# Experiment 028 — Usage Recording on ask / agent / analyze

## Objective

Experiment 017 built the cost ledger and wired it into `/api/chat`. The README's
Deferred list has said this since:

> Usage recording on ask / agent / analyze — only `/api/chat` records today

Three routes call the model and none of them bill for it. `/api/agent` is the worst
case on record: Experiment 011 already found that counting *requests* misrepresents
cost because one request can be several upstream calls, and the agent loop is exactly
where that gap is widest — several tool-calling turns, several `usage` objects, none
recorded.

## What happened

Read the three routes and `src/lib/ai.ts` before touching anything. The `usage` data
was never missing — `answerFromNotebook` and `runAgent` already yield a `{ type:
"done", usage, model }` event, the same shape `/api/chat` has consumed since 017.
`/api/ask` and `/api/agent` forward it to the client and let it fall on the floor.
`/api/analyze` doesn't stream at all; it returns `response.usage` in the JSON body and
never records it either — the number is generated for the caller to read but never
kept.

So there was no missing plumbing, only a missing three-line `if` per route — the exact
block `/api/chat` already has.

## What We Built

| Piece | What it is |
| --- | --- |
| `src/app/api/ask/route.ts` | Records each `done` event via `usage.record()`, route `"ask"` |
| `src/app/api/agent/route.ts` | Same, route `"agent"` — `upstreamCalls` suffixes `requestId` per step, so a multi-step run gets one ledger row per upstream call instead of colliding on the `UNIQUE` constraint |
| `src/app/api/analyze/route.ts` | Records the one `response.usage` it already had, route `"analyze"` |

All three follow `/api/chat`'s shape exactly: record before `send()`/`return`, log a
`usage` line on success, catch-and-log (never throw) on a ledger failure so a
bookkeeping error can't turn into a broken reply the user is already reading.

## Finding — the gap was never about missing data, only about a missing call site

017 built `recordUsage()` once and `/api/chat` called it once. Nothing stopped the
other three routes from doing the same — they simply never did, because there was
never a moment that forced anyone to look at all four routes together. `breakdownByRoute()`
in `src/lib/usage.ts` has grouped by route since 017; it just had three routes worth
of silent zeros to group.

## Decisions

**No new StreamEvent, no schema change.** The `done` event already carried `usage`
and `model` for every route that streams. Recording it needed a call site, not a new
field.

**`analyze` records with the request's own id, no suffix.** Unlike `chat` and `agent`,
it is not a loop — one call, one model response, one row. Matching the loop routes'
suffix pattern here would just be a static `-1` on every row for no reason.

**No new verify claim.** `scripts/verify-live.mts` already tests the model-call path
end to end (020); this wires an existing ledger into three more call sites and is
covered the same way `/api/chat`'s wiring is — by type-checking, the unit suite for
`recordUsage()` itself (`tests/usage.test.mts`), and reading the four routes side by
side to confirm they now match.

## Questions

- **Still unobserved.** Recording code that has never recorded a real response is a
  claim, not a fact, until it runs against a live call — the same limit
  `experiments/020-verification-debt` named for everything downstream of a model
  response. `pnpm check` and the type gate pass; a real `ANTHROPIC_API_KEY` is what
  turns this from "wired correctly" into "confirmed."
- **`breakdownByRoute()` will show three new rows the first time this runs for real** —
  worth checking that `ask` and `agent` costs land in the range 017's pricing model
  predicts, not just that a row appears.

## Status

| Piece | State |
| --- | --- |
| `/api/ask` records usage | ✅ Wired, type-checked — unobserved against a live call |
| `/api/agent` records usage, per upstream call | ✅ Wired, type-checked — unobserved against a live call |
| `/api/analyze` records usage | ✅ Wired, type-checked — unobserved against a live call |
| `pnpm check` | ✅ All gates pass |

## Next Step

Same as everything downstream of a live model call: an `ANTHROPIC_API_KEY` turns
"wired correctly" into "confirmed." Until then, `pnpm ci-status` (027) is at least
answerable without one.
