# Experiment 018 — Cost-Aware Context Management

## Objective

Experiment 003 measured a problem and did not solve it:

> "History grows quadratically in tokens billed, because every turn resends every
> prior turn. Measured, turn ten sends thirty times the bytes of turn one."

The project's entire response has been `MAX_TURNS = 20` — **a cliff, not a strategy.**
It reduces cost by nothing at all below turn 20; it only stops the conversation dead
at it.

Experiment 017 made cost a number the application can read. This experiment uses it:
the alternatives stop being a matter of taste and become comparable.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/context.ts` | Token estimation, sliding window, cost projection. Pure. |
| `scripts/project-cost.mts` | `pnpm cost` — the strategy comparison. |
| `ai.ts` → `withCachedPrefix()` | Prompt caching on the conversation prefix. |
| `tests/context.test.mts` | 30 assertions |
| `tests/caching.test.mts` | 21 assertions |

Test suite: **419 → 471 assertions.** New runtime dependencies: **none.**

## Key Concepts

**The quadratic.** Turn *k* resends every prior turn, so total input over *N* turns
grows with *N²*. Doubling the conversation length roughly **quadruples** the input
bill — verified below.

**Prefix caching.** Cache reads cost 0.1× input; writes cost 1.25×. Caching is a
**prefix match**: any byte change before the breakpoint invalidates everything after
it. The newest user message differs on every request, so it must fall *after* the
breakpoint — put it inside and the cache is invalidated by the very request meant to
read it, and the feature silently does nothing but add the write premium.

**Sliding window.** Send only the last *N* messages. Cheap, flat, and **it is not
compression — it is forgetting.** A fact established in turn 2 is gone by turn 30 and
the model proceeds confidently without it. The user is not told.

**Estimation is not measurement.** Counting tokens honestly needs the provider's
`count_tokens` endpoint, which needs a credential. `estimateTokens()` is a heuristic
(~4 chars/token) used **only** for projection and display — never for billing.
Billing uses the `usage` object the API returns (017). *An estimate that leaks into an
invoice is a lie with a decimal point.*

## Observations

### Observed — Experiment 003's measurement, reproduced exactly

003 said "turn ten sends thirty times the bytes of turn one", measured by eye. Modelled
precisely, turn 1 sends 1 message and turn 10 sends 19 (nine pairs plus the new user
message):

```text
✓ turn 1 sends 1 message-worth
✓ turn 10 alone sends 19
✓ that is 19x turn one — the same shape 003 measured by eye
```

### Observed — the growth really is quadratic

```text
✓ 10 → 20 turns is ~4x the input    4.00x
✓ 20 → 40 turns is ~4x again        4.00x
✓ 40 turns costs far more than 4x of 10 turns    16.0x
```

### Observed — `pnpm cost`

```text
   turns        full      window      cached   cheapest (lossless only)
  ------ ----------- ----------- -----------   ------------------------
       1     $0.0112     $0.0112     $0.0112   full
       2     $0.0250     $0.0250     $0.0256   full
       5     $0.0813     $0.0762     $0.0703   cached
      10     $0.2250     $0.1638     $0.1496   cached
      15     $0.4313     $0.2512     $0.2352   cached
      20     $0.7000     $0.3387     $0.3271   cached ← MAX_TURNS
      30     $1.4250     $0.5138     $0.5296   cached
      50     $3.6250     $0.8638     $1.0096   cached
     100    $13.5000     $1.7388     $2.6471   cached

  At this project's MAX_TURNS = 20:
    today (full history)  $0.7000  per conversation
    with prefix caching   $0.3271
    saving                $0.3729  (53%), losing nothing
```

**53% cheaper, forgetting nothing.** That is the decision, and it needed no judgement
once the number existed.

### Observed — where the money actually goes

```text
  input      $0.5000  71%   ← the only part context management can touch
  output     $0.2000  29%   ← billed at 5x, untouched by any strategy here
```

Worth stating plainly: **context management is an input-side lever only.** Output is
billed at 5× input and no amount of history trimming touches it. At 20 turns the
input side is 71% of the bill, so the lever is worth pulling here — but that ratio
is a property of this conversation shape, not a general fact.

### Observed — the strategies are not ordered the way I expected

See *Mistakes* below. The short version:

```text
✓ at 20 turns, caching beats the window on cost
    cached $0.3271 vs window $0.3387
✓ …while also forgetting nothing
```

At this project's scale the cheaper option is also the lossless one. **There is no
tradeoff to make** — which is the opposite of what the phrase "cost/quality tradeoff"
had led me to assume.

### Observed — but the ranking depends on conversation length

A cached prefix *grows*, so its read cost grows with it. A window is flat. There is
therefore a crossover, and it is computable:

```text
Caching is cheaper than a 6-turn window up to turn 25;
beyond that the growing cached prefix costs more to re-read than the
window costs to resend.
```

`MAX_TURNS = 20`, so this project sits entirely on the caching side of it. If the cap
were ever raised past ~25, the right answer changes — recorded so that the decision is
revisited rather than inherited.

```text
✓ short conversation: caching wins   $0.1171 vs $0.1288
✓ long conversation: the window wins $1.0388 vs $1.2871
✓ so there is no single right strategy — only a right one per length
```

### Not verified

- **No real `cache_read_input_tokens` has ever been observed.** The breakpoint
  placement is unit-tested, the arithmetic is verified, and the projection is exact
  given its token estimate — but whether the cache is actually *hit* can only be
  confirmed by the `usage` object of a live call. **Blocked on the credential.** This
  is the same seam as 017, and it is the one that matters: a cache that silently never
  hits costs 1.25× and looks fine.
- **The minimum cacheable prefix is not handled.** It is model-dependent (roughly
  1024–4096 tokens); a short conversation is below it and **will silently not cache** —
  no error, no warning, just no `cache_read_input_tokens`. Which is exactly why the
  first rows of the projection show caching costing slightly *more*.
- **`estimateTokens()` is unvalidated against a real tokenizer.** The ~4 chars/token
  heuristic is conventional and untested here. Every projection above inherits its
  error — the *shape* of the curves is exact, the absolute dollars are not.

## Mistakes / Failures

**I wrote two tests asserting the sliding window would be cheapest. Both failed.**

*What I expected.* That a 6-turn window — which throws away most of the conversation —
would obviously beat caching, which keeps all of it. Cheaper and worse; the classic
tradeoff. I was confident enough to encode it as an assertion.

*What actually happened.*

```text
✗ the window is the cheapest        window $0.3387
✗ the window saves more money       $0.3613 vs $0.3729
```

At 20 turns, caching is cheaper **and** lossless. The window pays 289 dropped
turn-sends to be *more expensive*.

*Why it happened.* I was reasoning about tokens *sent* rather than tokens *billed*. A
window sends 6 turns at the full input rate every turn. Caching sends far more — but
almost all of it at 0.1×. Six units at 1× is more expensive than twenty units at 0.1×,
and my intuition had no way to see that because it was counting the wrong thing.

*How it was diagnosed.* The failing assertions gave a number, not a verdict, so the
next step was to check whether the model was wrong or the prior was. Computing
per-turn cost by hand in units of "one turn at the full input rate":

```text
 turn | cached | window-6 | cheaper
    2 |   3.50 |     3.00 | window
    5 |   4.10 |     6.00 | cached
   14 |   5.90 |     6.00 | cached
   15 |   6.10 |     6.00 | window
   50 |  13.10 |     6.00 | window
```

The model was right. The prior was wrong, and it was wrong in an interesting way —
there are *two* crossings, not one.

*The fix.* The tests now assert what is true, including the length-dependence, and the
experiment gained its actual finding.

**A second, smaller error fell out of the same place.** My first crossover calculation
took the *first* turn where the window became cheaper and reported **turn 2** — a
transient, where caching has paid a write premium with almost nothing yet to read back.
The number that matters is the *last* crossing (turn 25). Taking the first is simply
wrong, and it would have justified the opposite decision.

*What this taught me.* "Cheaper but worse" is a shape I expected so strongly that I
wrote it down as a test before checking. The measurement existed only because
Experiment 017 made cost readable — **the value of building the instrument is that it
can contradict you**, and an instrument that only ever confirms you is not being read.

## Decisions

**Prefix caching, not a sliding window.** At `MAX_TURNS = 20` it is 53% cheaper and
loses nothing. The window's advantage begins at turn 25, which this project cannot
reach. Decision recorded with its expiry condition: *if the cap is raised past ~25,
re-run `pnpm cost` and revisit.*

**No summarisation.** The third option, and it costs an extra model call per
compaction, adds a failure mode (a bad summary silently corrupts all later context),
and cannot be evaluated without a credential. Two lossless options already beat the
status quo. *Deferred — and it becomes the right question once conversations exceed
the caching crossover.*

**One breakpoint, on the last message of the prior history.** The API allows four.
One is what this strategy needs, and each additional breakpoint is another prefix that
must stay byte-stable.

**`estimateTokens()` is deliberately kept away from the ledger.** Projections use the
estimate; billing uses the API's `usage`. Keeping them separate is the point.

**`MAX_TURNS = 20` stays.** It is a context-window and abuse guard, not a cost control
— and it never was one. Now that something else is doing the cost job, its actual role
is clearer rather than redundant.

## Questions

- **Whether the cache ever hits is unverified**, and a silently-never-hitting cache
  costs 1.25× while looking correct. The check is one line — `usage.cache_read_input_tokens
  > 0` — and 017 already records the field. *Blocked on the credential; it should be
  the first thing looked at when one exists.*
- **The minimum cacheable prefix is not checked before marking.** Marking a prefix too
  short to cache is a pure loss. `estimateTokens()` could gate it, at the cost of
  trusting an unvalidated estimate for a billing-adjacent decision.
- **`/api/ask` and `/api/agent` do not use `withCachedPrefix()`.** The agent loop
  re-sends a growing working history on every iteration — the same quadratic, inside a
  single request. *Next increment, and the one with the most to gain.*
- **The system prompt and tool definitions are not cached.** They are byte-stable
  across every request in a persona and sit at the very front of the prefix — the
  cheapest possible thing to cache, and currently re-billed every turn.
- **Projections assume every turn is the same size.** It makes the shape visible and
  does not predict any one real conversation. Real transcripts exist in the database
  now; projecting from those would be more honest.
- **No cost shown to the user.** `conversation_id` is on every ledger row (017) and
  nothing surfaces it. Showing "this conversation has cost $0.03" would make the
  quadratic visible to the person causing it.

## Status

| Piece | State |
| --- | --- |
| `context.ts` — estimation, window, projection | ✅ Verified, 30 assertions |
| `pnpm cost` — strategy comparison | ✅ Verified |
| Quadratic growth reproduced from 003 | ✅ **Verified — 4× per doubling, 19× at turn 10** |
| Cache breakpoint placement | ✅ Verified, 21 assertions |
| Caching wired into `runToolLoop` | ✅ Built; app verified still working |
| **A real cache hit** | ⛔ **Blocked — no API credential** |
| Minimum-prefix guard | ⬜ Open |
| Caching on ask / agent | ⬜ Next increment |
| Summarisation | ⬜ Deferred with its trigger condition |

## Next Step

**Experiment 019 — The Agent Loop's Own Context.**

018 fixed the quadratic *between* requests and left it untouched *inside* one. The
agent loop appends every tool call and every tool result to a working history and
re-sends the whole thing on each iteration — up to `MAX_STEPS = 6` times within a
single user turn, at full input price, with no breakpoint.

That is the same curve 003 measured, on a shorter axis, on the route Experiment 017
identified as the one whose cost the request-count proxy misrepresented worst. It also
raises a question 018 did not have to answer: tool *results* can be large and are not
always worth keeping, which is where context editing (clearing old tool results) is a
better fit than either caching or a window.

Measurable with the instrument that now exists.
