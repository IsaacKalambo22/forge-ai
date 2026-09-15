# Experiment 019 — The Agent Loop's Own Context

## Objective

Experiment 018 fixed the quadratic **between** requests and left it untouched
**inside** one.

`runAgent()` appends the model's tool requests and our tool results to a working
history and re-sends the whole thing on every iteration — up to `MAX_STEPS = 6` times
within a single user question. Same curve as Experiment 003 measured for
conversations, on a shorter axis, inside one HTTP request the user experiences as
asking one thing.

It is also the route Experiment 017 identified as the one the request-count proxy
misrepresented worst: one request, six upstream calls.

And it raises a question 018 did not have to answer. A conversation turn is something
the user said and may refer back to. **A stale search result is mostly ballast** — so
there is a third option here that does not exist for conversations: throw it away.

## What We Built

| File | What it is |
| --- | --- |
| `context.ts` → `pruneToolResults()` | Clears old tool-result *content*, keeps the blocks |
| `context.ts` → `projectAgentRun()` | Segment-level projection that models cache invalidation |
| `scripts/project-cost.mts` | `pnpm cost` now covers the agent loop too |
| `ai.ts` → `runAgent()` | Pruning wired in, `keepRecent = 3` |
| `tests/agent-context.test.mts` | 28 assertions |

Test suite: **471 → 499 assertions.** New runtime dependencies: **none.**

## Key Concepts

**You cannot simply drop a stale tool result.** Every `tool_use` block must have a
matching `tool_result` with the same `tool_use_id`. Remove one and the request is
**malformed, not cheaper** — the API rejects it. So pruning replaces the *content*
with a short placeholder and leaves the block, and its id, in place.

This is what makes it a different operation from a sliding window. A window removes
messages; removing half a tool_use/tool_result pair is a 400.

**Caching needs an append-only history.** Prompt caching is a *prefix match*: the
prefix must be byte-stable for the cache to be read. A conversation only ever appends,
which is why 018's answer was caching. An agent loop that prunes does **not** append —
it edits an earlier result from a full passage to a placeholder, and that edit moves
the divergence point backwards, invalidating everything after it.

## Observations

### Observed — the loop has its own quadratic

```text
✓ doubling the steps more than doubles the input    5.58x
✓ and again                                         2.46x
```

### Observed — `pnpm cost`, agent section

```text
         strategy   input  cacheRead  cacheWrite      cost
  --------------- ------- ---------- ----------- ---------
             full   13200          0           0   $0.0660
           cached      50       8850        4300   $0.0316
           pruned    5320          0           0   $0.0266
    pruned+cached      50        922        4348   $0.0279
```

**Pruning wins, and pruning + caching is worse than pruning alone.**

### Observed — tool results really are the bulk

```text
✓ pruning cuts the working history substantially
    1163 → 389 tokens (67% smaller)
```

### Observed — THE FINDING: two optimisations that cancel each other

The read/write split makes the mechanism visible:

```text
cached          8850 read   4300 written     ← healthy 2:1 reuse
pruned+cached    922 read   4348 written     ← reuse collapsed ~90%
```

Pruning edits the prefix on every step, so the cache is invalidated from the edit
point onward. Almost nothing is read back, and the **1.25× write premium is still paid
in full** — so the combination costs more than pruning alone while doing more work.

```text
✓ pruned+cached is more expensive than pruning alone   $0.0279 vs $0.0266
✓ because the cache is barely read at all              922 vs 8850
✓ while the 1.25x write premium is still paid in full  4348 vs 4300
```

The general rule, stated as a test:

```text
✓ append-only: most of the history is read, not rewritten   8850 read vs 4300 written
✓ edited history: most of it is rewritten every step        4348 written vs 922 read
```

**018 and 019 reach opposite conclusions about caching, and both are right**, because
a conversation appends and a pruned agent loop edits.

### Not verified

- **The quality cost of pruning.** This agent is instructed to *cite the source files
  it used*, and a cleared passage cannot be cited. `keepRecent = 3` (half of
  `MAX_STEPS`) is a hedge, not a measurement. **Blocked on the credential** — and the
  right tool to settle it already exists: the labelled eval harness from Experiment
  013, pointed at answer quality rather than retrieval rank.
- **No real cache behaviour observed**, same seam as 018. The invalidation model above
  is arithmetic over how prefix caching is documented to work, not an observation of it
  working.
- **`estimateTokens()` is still unvalidated.** Every figure here inherits its error;
  the shapes are exact, the absolute dollars are not.
- **Real agent runs may not reach 6 steps.** The projection uses the ceiling. A
  typical run is probably 2–3 steps, where the saving is proportionally smaller — and
  `decide()` stops early on repeats. Unmeasured, because no agent loop has ever
  executed.

## Mistakes / Failures

**I asserted that combining both optimisations would be cheapest. It was not — and the
first version of my model could not have told me either way.**

*What I expected.* Pruning shrinks the history; caching discounts what remains; both
together should be best. I wrote it as a test.

*What happened.* The test failed: `pruned+cached $0.0276` against `pruned $0.0266`.

*The part that mattered more than the failing assertion.* My first `projectAgentRun()`
treated the two strategies as independent — it summed a total per step and applied a
cache discount to it. A total cannot express *where* two requests start to differ, and
"where" is the entire mechanic of prefix caching. It also contained a dead ternary,
`prune ? resultTokens : resultTokens`, which is what a model looks like when it is
computing the right answer for no reason.

So the model was producing a roughly-correct number by accident while being unable to
represent the phenomenon. Had the numbers come out the way I expected, I would have
shipped it and learned nothing.

*The fix.* Rewrote the projection to build each request as an ordered list of
**segments**, then find the first index at which the current request diverges from the
previous one — which is exactly how a prefix cache decides what it can reuse. The
interaction then *emerges* from the model instead of having to be asserted:

```ts
let diverge = 0;
while (previous[diverge] === current[diverge]) diverge++;
cacheReadTokens += segmentsBefore(diverge);
cacheWriteTokens += everythingElse;
```

*What it taught me.* Two things. **A model that cannot represent the mechanism can
still produce plausible numbers**, and plausible numbers are the hardest kind of wrong
to notice — the failing test was luck, not diligence. And the practical rule:
**optimisations are not additive, because one can destroy the precondition another
depends on.** Caching's precondition is a stable prefix. Pruning's whole job is to
change the prefix.

## Decisions

**Prune the agent loop; do not cache it.** 60% cheaper per run ($0.0660 → $0.0266) and
measurably better than caching, which is the opposite of 018's decision for
conversations — recorded with the reason, so the inconsistency reads as a conclusion
rather than an oversight.

**`keepRecent = 3`, half of `MAX_STEPS`.** Explicitly a hedge against an unmeasured
citation regression rather than a tuned value. Written as a named constant with that
caveat at its definition, so the next person changing it knows it was never measured.

**Clear content; never remove the block.** The `tool_use_id` pairing requirement makes
the alternative a malformed request. Asserted in a test, because a 400 from the
provider is a slow way to learn it.

**Local pruning, not the API's `clear_tool_uses_20250919` context-editing beta.** The
server-side feature does this job and is the eventual right answer. It is also a beta
that cannot be tested without a credential, and the project rule is to understand the
simple implementation first. A pure function is testable today. *Recorded as the
migration when a credential exists.*

**No caching of the system prompt or tool definitions here either.** They are
byte-stable and sit at the very front — genuinely worth caching, and out of scope for
an experiment about the growing part.

## Questions

- **`keepRecent` is unmeasured and directly affects answer quality.** The most
  important open item in this experiment. 013's harness plus a credential settles it.
- **Pruning and caching could be combined properly** by only clearing results *behind*
  a fixed breakpoint and never editing anything after it — then the edited region is
  outside the cached prefix. More complex, and it needs a real cache hit to validate.
  *Deferred, and the arithmetic above says the gain is small.*
- **`/api/ask` still uses neither.** It retrieves passages and streams — no loop, but
  the same large passages in context.
- **The system prompt and tool definitions are re-billed on every iteration.**
  Byte-stable, at the front of the prefix, and the cheapest possible thing to cache.
- **Usage is still not recorded for `/api/agent`** (017). It is the route where one
  request is six calls, so it is the one whose ledger rows would be most informative.
- **Projections assume every step is the same size.** Real runs vary, and `decide()`
  stops early on repeats — both make real runs cheaper than projected.

## Status

| Piece | State |
| --- | --- |
| `pruneToolResults()` — content cleared, pairing preserved | ✅ Verified, 28 assertions |
| `projectAgentRun()` — segment-level invalidation model | ✅ Verified (rewritten after the failure above) |
| The loop's quadratic, measured | ✅ Verified |
| **Pruning + caching is worse than pruning alone** | ✅ **Verified — reuse collapses 8850 → 922** |
| Pruning wired into `runAgent` | ✅ Built; suite and build green |
| Quality impact of `keepRecent` | ⛔ **Blocked — needs a credential and 013's harness** |
| A real cache hit / real agent run | ⛔ Blocked |
| Caching the system prompt and tools | ⬜ Open |

## Next Step

**Experiment 020 — Closing the Verification Debt.**

Five experiments now end with the same sentence. The blocked list has grown from a
footnote into the largest single category in the project:

```text
002  do personas actually change model behaviour?
005  does the model conform to the schema?
006  does the tool loop ever execute?
009  does the agent loop ever execute?
017  a ledger row written from a live usage object
018  does the cache ever actually hit?
019  what does keepRecent=3 cost in answer quality?
```

Every one needs the same single thing, and several are now load-bearing: 018 and 019
made *decisions* on projected numbers, and a cache that silently never hits costs 1.25×
while looking fine.

Rather than adding a twentieth feature on top, 020 should build the harness that turns
a credential into answers — one script that exercises every blocked claim and prints a
verified/failed table — so that acquiring a key converts the blocked list into results
in one run instead of seven separate investigations. The harness itself is testable
against recorded fixtures today.
