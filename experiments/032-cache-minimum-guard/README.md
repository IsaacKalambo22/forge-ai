# Experiment 032 — The Minimum-Cacheable-Prefix Guard

## Objective

018 documented it. 031 repeated the documentation. Neither one *acted* on it:

> "The minimum cacheable prefix is not handled. It is model-dependent (roughly
> 1024–4096 tokens); a short conversation is below it and will silently not
> cache — no error, no warning, just no `cache_read_input_tokens`."

An unhandled honest limitation is still unhandled. This experiment closes it —
gate both caching call sites on an estimated size before marking `cache_control`
at all, rather than marking unconditionally and hoping the prefix is big enough.

## What happened — a measurement, not just a review

Before touching any code: what does `ASK_SYSTEM_PREAMBLE` (031) actually estimate
at? This needs no credential — `estimateTokens()` is a local heuristic (chars/4),
already in `src/lib/context.ts` since 018.

```text
ASK_SYSTEM_PREAMBLE: 485 characters → ~122 estimated tokens
```

**That's roughly a tenth of the documented minimum, not close to it.** Which means
031's `withCachedAskSystem`, as shipped, was marking `cache_control` on every single
`/api/ask` call — paying the 1.25x cache-write premium on the preamble's tokens,
for a cache that (per the API's own documented floor) can never be read back. Not a
future risk contingent on the API credential arriving — a live cost bug, today,
in code this project had already merged.

018's `withCachedPrefix` had the same unhandled gap, just less severe: a short
conversation (few turns) is also below the minimum and was also being marked
unconditionally. It self-heals as a conversation grows past a few turns, where
031's preamble structurally cannot — it's fixed-size prose with no mechanism to
grow larger.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/context.ts` | `MIN_CACHEABLE_TOKENS = 1024` and `worthCaching(estimatedTokens)` — the documented floor as a checkable predicate, not just a comment. |
| `src/lib/ai.ts` | `withCachedPrefix()` now estimates the prefix's tokens (`estimateMessageTokens`) and returns `messages` unmarked if `!worthCaching(...)`. `withCachedAskSystem()` estimates the preamble and only attaches `cache_control` when large enough — the two-block *shape* is unchanged either way, only the breakpoint is conditional. |
| `tests/caching.test.mts` (rewritten) | The short-fixture tests from 018 (`"one"`, `"two"`, `"three"`) now assert the opposite of before: **not marked**, because they're nowhere near the minimum — which is the honest behavior the fixtures always should have tested. New large-fixture tests (`MIN_CACHEABLE_TOKENS * 4` characters) prove marking still happens once a prefix is genuinely big enough. |
| `tests/ask-caching.test.mts` (rewritten) | First group measures `ASK_SYSTEM_PREAMBLE` directly — `~122 tokens < 1024` — and asserts the real preamble is *not* marked today. A second, synthetic large-preamble group proves the mechanism still works when it would matter. |
| `tests/context.test.mts` | 4 direct assertions on `worthCaching()` — the boundary (`MIN_CACHEABLE_TOKENS - 1` vs exactly `MIN_CACHEABLE_TOKENS`), and zero. |

Test suite: **761 → 771 assertions.** New runtime dependencies: **none.**

## Important concepts

**"Documented" and "handled" are different states.** 018 wrote the limitation down
accurately. It stayed a comment for two experiments because nothing forced anyone to
act on it — the code kept working, just wastefully, and nothing failed loudly. The
fix here isn't cleverness, it's turning a known number into a runtime check.

**A cache write below the minimum is not neutral — it's a loss.** The intuitive
model is "small cache = small benefit." The actual documented behavior is closer to
"small cache = the write premium with none of the read discount, ever." Below the
floor, every dollar spent on the 1.25x write is pure waste, because there is no
mechanism by which it comes back as a 0.1x read. That asymmetry is why this was
worth fixing now rather than "eventually."

**A heuristic can still drive a real decision, as long as it's honest about what
it's not.** `estimateTokens()` was built in 018 explicitly *not* to touch billing.
This experiment uses it for something else billing-adjacent but distinct: a
before-the-request decision about whether an optimization is worth attempting. Wrong
by 20% in either direction still lands on the same side of a 1024-token line for
`ASK_SYSTEM_PREAMBLE`'s ~122 — the margin is wide enough that estimation error
doesn't change the conclusion.

## Decisions

**The threshold is 1024, not a range.** The documented minimum is model-dependent
(1024 for Opus/Sonnet, 2048 for Haiku). This project only ever calls Opus/Sonnet
(`"claude-opus-5"`, hardcoded in every `anthropic.messages.stream()` call) — so the
lower, more permissive number is the correct one here, not a compromise.

**No attempt to grow `ASK_SYSTEM_PREAMBLE` to clear the threshold.** Padding it with
filler text to cross 1024 tokens would manufacture exactly the kind of hollow metric
this project has been explicit about avoiding — the padding would cost real tokens
on every request (raising the bill) purely to make a different number look better.
If the preamble legitimately grows later — more rules, more context — it may cross
the line on its own merits; that is not this experiment's job to force.

**`withCachedAskSystem` still returns two blocks either way.** Below the minimum,
the function still splits the system prompt into the same two-block shape, just
without a breakpoint on the first. This keeps `answerFromNotebook`'s call site
identical regardless of the size decision — the caller doesn't need to know or care
whether caching was worth attempting this time.

## Not verified

- **Whether the *real* provider-side minimum matches the documented 1024.** This
  project has never made a live call with `cache_control` set, so "1024" is taken on
  faith from published documentation, not confirmed against this project's own
  traffic. If it's wrong, `MIN_CACHEABLE_TOKENS` is wrong with it — recorded so the
  number gets revisited once a credential exists, not trusted forever.
- **The `withCachedPrefix` conversation-length threshold.** With this guard, a
  conversation needs to be long enough that its *history* alone clears 1024
  estimated tokens (not one message — the whole prefix). `pnpm cost`'s projection
  already assumed caching "just works" from turn 2; that assumption was optimistic
  in the same direction 018's own "Not verified" section already flagged. This
  experiment doesn't rerun that projection — a fair one would need a token size
  where the guard actually engages, which depends on real message length, not the
  synthetic uniform-size model `project()` uses.

## Status

| Piece | State |
| --- | --- |
| `MIN_CACHEABLE_TOKENS` / `worthCaching()` | ✅ Verified (4 direct assertions) |
| `withCachedPrefix` — skips marking below the minimum | ✅ Verified |
| `withCachedPrefix` — still marks once large enough | ✅ Verified |
| `withCachedAskSystem` — the real `ASK_SYSTEM_PREAMBLE` is measured, confirmed below the minimum, and NOT marked | ✅ Verified (measured live in the test, not asserted from memory) |
| `withCachedAskSystem` — still marks a large-enough preamble | ✅ Verified |
| Real cache_read_input_tokens / real provider minimum | ⬜ Blocked — no credential |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

The credential remains the deepest blocker across 017/018/020/028/031 — nothing new
to build against it right now. Worth returning to the UI (per the standing direction:
build real functionality, not just documentation) — the next candidate is whichever
concrete gap surfaces on inspection, the same discipline that kept `ask.tsx` untouched
last round when it didn't have one.
