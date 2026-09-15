# Experiment 017 — Cost and Token Accounting

## Objective

Three experiments deferred the same item for the same reason:

| Recorded in | The gap |
| --- | --- |
| 011 | Spending is capped by counting **requests** — a proxy, not money |
| 014 | Wanted token counts per request; there has never been a `usage` object |
| 015 | Built a durable store and put no billing facts in it |

The proxy is the interesting failure. `DAILY_PAID_REQUESTS = 200` bounds the *rate*
of paid work and says nothing about the *bill*, because a request is not a fixed
amount of money:

```text
one /api/agent call        = up to 6 upstream calls
turn 1 of a conversation   = one short prompt
turn 20                    = the entire history, resent and re-billed
a cache hit                = a tenth of the input price
```

Two hundred requests could be forty cents or forty dollars. This experiment
replaces the proxy with the thing itself.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/pricing.ts` | Rate table, integer cost arithmetic. Pure, no imports. |
| `db.ts` migration 4 | The `usage` ledger. |
| `src/lib/usage.ts` | Record and aggregate spend, per user and per route. |
| `guard.ts` | Budget enforced in **dollars**, read from the ledger. |
| `/api/chat` | Records every upstream call's `usage`. |
| `/api/metrics` | Now reports budget and 24h spend beside latency. |

Test suite: **364 → 419 assertions.** New runtime dependencies: **none.**

## Key Concepts

**Rates.** Anthropic first-party API, verified 2026-09-15. The project calls
`claude-opus-5`:

| | $/MTok | Multiple of input |
| --- | --- | --- |
| Input | $5.00 | 1× |
| Output | $25.00 | 5× |
| Cache read | $0.50 | 0.1× |
| Cache write (5-min TTL) | $6.25 | 1.25× |
| Cache write (1-hour TTL) | $10.00 | 2× |

**Output is 5× input.** Most cost-control intuition is about shortening prompts; the
lever with five times the leverage is on the other side.

**Caching break-even.** A cache write costs 1.25× and a read 0.1×, so two requests
over the same prefix cost 1.35× against 2× uncached — cheaper. *One* request costs
1.25× against 1×: **caching a prefix you use once is strictly more expensive.** At the
1-hour TTL (2× write) it takes three.

**Money is never a float.** `0.1 + 0.2 === 0.30000000000000004`. Every cost here is an
integer count of **nanodollars** (1e-9 USD). Not paranoia about one request — about
the *sum*. Add a million floating-point fractions of a cent and the error is real
money that belongs to nobody and reconciles with nothing.

Nanodollars specifically, because `$X per million tokens` is exactly `X × 1000`
nanodollars per token — every rate is a whole number with no rounding anywhere.
**Microdollars would not manage it**: $0.50/MTok is 0.5 microdollars per token, and
the fraction comes straight back.

**Idempotency key.** `usage.request_id` is UNIQUE and carries the correlation id from
014, so a retry cannot double-bill and a ledger row and a log line are the same
request.

## Implementation

**An unknown model throws; it never costs zero.** A silent zero is the worst failure
available here — spending continues, the budget never notices, and the logs agree
everything is fine. There is a test that `claude-opus-5-20260401` is *not* silently
accepted, because a plausible-looking id is exactly what would slip through.

**`unpricedFields()` detects a token category we do not price.** If Anthropic adds a
billable field, `costOf()` would ignore what it does not recognise and every invoice
would quietly exceed every total recorded here. Unknown fields are logged as
`recorded cost is a LOWER BOUND` — loud, but not fatal, because refusing to record
would lose the cost we *do* know.

**`ON DELETE SET NULL`, not `CASCADE`, from conversations.** Deleting a conversation
must not delete the record that it cost money. The spend happened.

**The tool loop emits several `done` events, one per upstream call.** Each becomes its
own ledger row (`${requestId}-1`, `-2`, …) rather than being deduplicated away by the
UNIQUE constraint — which is the request-vs-cost mismatch, now visible in the data.

**An accounting failure never breaks a reply in progress.** Recording is wrapped: loud
in the log, invisible in the stream.

## Testing

```bash
pnpm test                    # 419 assertions
pnpm dev                     # then seed the ledger and watch the guard refuse
```

## Observations

### Observed — integer money is exact; float money is not

A thousand identical charges, summed both ways:

```text
✓ 1000 identical charges sum exactly          (integer nanodollars)
✓ the same sum in floating-point dollars does NOT land exactly
    drifted by 1.421e-14 dollars
```

Trivially small on a thousand rows. It is the same arithmetic on a million.

### Observed — the caching break-even, in this project's own numbers

```text
✓ two requests: cached is cheaper    $6.7500 vs $10.0000
✓ one request: caching costs MORE    $6.2500 vs  $5.0000
```

### Observed — the budget is enforced on money, verified end to end

The ledger was seeded with what a real run *would* have recorded, using the same
`costOf()` the app uses. Default budgets: $5 total, $1 per user.

```text
ledger $0.9000   POST /api/chat                                    [HTTP 200]
ledger $1.1000   POST /api/chat   {"error":"Your daily budget is exhausted"} [429]
```

Then past the global ceiling:

```text
ledger $5.6000   POST /api/chat   {"error":"Daily budget exhausted"}         [429]
server log:      Daily budget exhausted: $5.6000 of $5.0000
```

### Observed — free routes still work while the paid budget is exhausted

```text
POST /api/search   [HTTP 200]
```

`COST[route] === 0` skips the budget check entirely. Semantic search runs a local
model and spends nothing, so a spending limit has no business refusing it — the
distinction Experiment 011 drew with `COST`, now doing real work.

### Observed — spend is visible beside latency

```json
"budget":  { "daily_budget": "$5.0000", "spent_today": "$1.1000",
             "remaining": "$3.9000", "per_user_budget": "$1.0000" },
"spend_24h": { "chat": { "requests": 4, "inputTokens": 400000,
                         "outputTokens": 80000, "costNanodollars": 1100000000 } }
```

014 answered *how fast* and *how often*. This is *how much*, and it belongs in the
same place.

### Observed — budgets are operator-settable without a code change

Same $5.60 ledger, `FORGE_DAILY_BUDGET_USD=50 FORGE_USER_DAILY_BUDGET_USD=20`:

```text
"daily_budget": "$50.0000", "remaining": "$44.4000"
the request that was refused now succeeds   [HTTP 200]
```

### Not verified

- **No ledger row has ever been written from a live model response.** The recording
  path runs on the `done` event, and `done` requires a successful call. The
  arithmetic, the schema, the aggregation and the enforcement are all verified; the
  join between them and a real `usage` object is not. **Blocked on the credential** —
  and it is the whole reason this experiment was designed around fixtures.
- **Cache-token accounting is unexercised in practice.** The rates and arithmetic are
  tested; this project never sets `cache_control`, so no real response has reported
  those fields.
- **Only the 5-minute cache write rate is applied.** The API reports one
  `cache_creation_input_tokens` figure, and this project never requests a 1-hour TTL,
  so that is exact today — and would **under-bill by 1.6×** if a 1h TTL were ever
  introduced. Recorded rather than assumed away.

## Mistakes / Failures

**I nearly used microdollars, which would have reintroduced the bug I was avoiding.**

The first sketch stored money as integer microdollars — the conventional choice, and
it looked obviously sufficient: the cheapest rate in play is $0.50/MTok, and money is
usually counted in cents.

Writing the rate table is what caught it. $0.50 per million tokens is **0.5
microdollars per token** — a fraction, in the units chosen specifically to avoid
fractions. Every cache read would have rounded, and the rounding would have been
systematic rather than random, so a long-running cache-heavy workload would drift in
one direction forever.

*How it was caught.* Not by a test — by trying to write `cacheRead: ` and having no
integer to put there. The unit was wrong before any code depended on it.

*The fix.* Nanodollars, plus `perMTok()`, which **throws** if a price is not a whole
number of them:

```ts
if (!Number.isInteger(nano)) {
  throw new Error(`Price $${dollars}/MTok is not a whole number of nanodollars`);
}
```

*What it taught me.* "Use integers for money" is the well-known half of the rule. The
half that actually bites is **choosing the unit small enough for the smallest rate you
will ever multiply by**, and that is a property of the price list, not of the currency.
A guard that rejects a fractional rate at construction is worth more than a test of
the cases I happened to think of, because the failure arrives with a *future* price
list rather than with today's.

## Decisions

**Pricing is a hardcoded table, not fetched.** It changes rarely, a network call in
the cost path is a failure mode, and a wrong-but-recorded rate is auditable in a way
that a silently-refreshed one is not. The table carries the date it was verified.

**Budgets in the environment, defaults in code.** $5/day total and $1/day per user are
deliberately small — this is a learning project that has never successfully called the
API, and the appropriate default for "unknown spend" is "not much".

**The request-count limiter was kept, not replaced.** It bounds the *rate* of paid
work, which is a different job from bounding the bill — and it still works when the
ledger is empty. Two controls, two failure modes.

**The budget check is a ceiling with a lip, and this is stated rather than hidden.**
It authorizes on spending *so far*; the cost of the request being authorized is
unknowable until it finishes, so the budget can be exceeded by one in-flight request,
or by several arriving together. Making it exact needs a reservation table and
`count_tokens` before each call, reconciled after. *Deferred, and documented in the
function, so the guarantee is not overstated.*

## Questions

- **Overshoot is unbounded by concurrency.** Ten simultaneous requests all read the
  same under-budget total and all proceed. Per-request cost is small so the practical
  exposure is small, but the mechanism has no lock. *Deferred with the reservation
  table.*
- **`/api/agent`, `/api/ask` and `/api/analyze` do not record usage yet.** Only
  `/api/chat` does. They are the same three lines each, and the agent route is the one
  where it matters most — it is the route whose cost the request count misrepresents
  worst. *Next increment.*
- **No per-conversation cost display.** The data is there (`conversation_id` on every
  row); nothing surfaces it. A "this conversation has cost $0.03" line would make the
  quadratic growth from Experiment 003 visible to the person causing it.
- **No alerting on spend.** Same gap 014 recorded for metrics: a number nobody looks
  at is a number nobody has.
- **The ledger is never pruned.** It should not be — it is a financial record — but it
  grows forever and has no retention policy or archive.
- **Nothing reconciles against an actual invoice.** These totals are what the project
  *believes* it spent. Until they are compared with a bill, they are arithmetic over
  self-reported numbers.

## Status

| Piece | State |
| --- | --- |
| `pricing.ts` — rates, integer arithmetic | ✅ Verified, 33 assertions |
| `usage.ts` — ledger, aggregation, idempotency | ✅ Verified, 22 assertions |
| Migration 4 | ✅ Verified |
| **Budget enforced in dollars** | ✅ **Verified end-to-end against a seeded ledger** |
| Free routes exempt | ✅ Verified |
| Operator-settable budgets | ✅ Verified |
| Spend on `/api/metrics` | ✅ Verified |
| Recording from a **live** `usage` object | ⛔ **Blocked — no API credential** |
| Usage on ask / agent / analyze | ⬜ Next increment |
| Reservation-based hard cap | ⬜ Deferred |

## Next Step

**Experiment 018 — Cost-Aware Context Management.**

017 built the instrument; 018 should use it. Experiment 003 measured that history
grows quadratically in tokens billed — *"turn ten sends thirty times the bytes of turn
one"* — and the project's only response has been `MAX_TURNS = 20`, a cliff rather than
a strategy.

Now that cost is a number the application can read, the alternatives become
comparable rather than a matter of taste: prompt caching on the conversation prefix
(measurable against the 1.35×-vs-2× break-even established here), trimming or
summarising old turns, and the token-counting endpoint to price a request *before*
sending it — which is also what the reservation-based hard cap needs.

Most of it is measurable with recorded fixtures. The final numbers need the credential.
