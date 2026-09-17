# Experiment 031 — /api/ask Prefix Caching

## Objective

Experiment 018 cached `/api/chat`'s conversation history and measured a real
projected saving (53% at `MAX_TURNS`). `/api/ask` never got the same treatment.
The question wasn't "copy the implementation over" — it was whether the same
mechanism even applies to a route shaped completely differently, and if not, what
does.

## What happened — inspecting before building

**`/api/chat`'s caching (`withCachedPrefix` in `src/lib/ai.ts`):** marks a breakpoint
on the last message of the conversation's *prior* history, leaving the newest message
(which differs every call) outside it. It works because the thing being cached — the
conversation so far — genuinely grows and repeats: turn 10 resends turns 1–9
byte-for-byte.

**`/api/ask`'s request construction (`answerFromNotebook` in `src/lib/ai.ts`,
before this experiment):** one call, one question, no conversation. The system
prompt was built as a single string: a notebook-framing sentence, then
`passageInstructions(nonce)` (instructions that *name the nonce inline*), then the
retrieved passages. **Every one of those three pieces changes on every call** — the
nonce because Experiment 010 requires a fresh, unguessable one per request (a static
delimiter is one a corpus entry could pre-empt), the passages because retrieval
depends on the question. There was no stable prefix anywhere in it — not "a short
one," none.

So the direct port doesn't exist. `/api/ask` has no growing history to put a
breakpoint after. What it has instead: **the general instructions are the same
words regardless of which nonce or which passages are in play** — but the original
code interleaved the nonce into that very sentence (`"Retrieved passages appear
below inside <${tag}> tags..."`), so the stable words and the unstable nonce were
one un-splittable string.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/passage.ts` | `passageInstructions(nonce)` split into `PASSAGE_RULES` (the rules, nonce-free, identical every call) and `passageDelimiterNotice(nonce)` (the one line that must differ). `passageInstructions()` itself is now just their concatenation — unchanged output for its one remaining caller, `src/lib/tools.ts`'s `search_notebook` tool result. |
| `src/lib/ai.ts` | `ASK_SYSTEM_PREAMBLE` — the notebook-framing sentence + `PASSAGE_RULES`, a module-level constant, byte-identical on every `/api/ask` call. `withCachedAskSystem(preamble, nonce, passages)` — builds the two-block `system` array: block 1 (the preamble) carries `cache_control: { type: "ephemeral" }`; block 2 (delimiter notice + passages) carries none. `answerFromNotebook()` now calls it instead of concatenating one string. |
| `tests/ask-caching.test.mts` | 15 assertions: exactly one breakpoint, on the right block; the preamble block is passed through untouched; two different questions produce a **byte-identical** preamble block (the entire mechanism, verified structurally) while the dynamic block differs; the preamble itself never contains a passage-tag pattern. |
| `tests/passage.test.mts` (extended) | 5 more assertions on the split: `PASSAGE_RULES` carries no nonce, two different nonces produce different notices, `passageInstructions()` still equals the two pieces joined. |

Test suite: **742 → 761 assertions.** New runtime dependencies: **none.**

## Important concepts

**Prompt caching is a prefix match — full stop.** 018 already knew this, but this
experiment is what happens when a route simply doesn't *have* a prefix to match.
Not every optimization from one route transfers to another shaped differently; the
first job is checking whether the precondition holds, not reapplying the pattern.

**A security requirement and a performance optimization pointed in opposite
directions, and security won without a fight.** The nonce exists so a corpus entry
can never pre-write a matching closing delimiter (010). Caching wants long-lived,
repeated bytes. A nonce that repeated would defeat the defence it exists for. There
was no tension to resolve here — the nonce was never a caching candidate, and no
version of this change touches it.

**System prompts can be arrays of blocks, not just one string.** `system:
Array<TextBlockParam>` — each block can carry its own `cache_control`. That's what
made the split possible at all: cacheable and non-cacheable content can sit in the
same system prompt as long as they're different blocks, sent in order.

## Decisions

**`passageInstructions()` was kept, not deleted.** `src/lib/tools.ts`'s
`search_notebook` tool result (used by `/api/agent`'s tool-calling loop) still wants
one combined string — it's a tool result appended mid-conversation, not a
system-prompt prefix, so there's nothing to cache there and splitting it would only
add a call site for no benefit. One function, two callers, only one of which needed
the split.

**No attempt to game the minimum cacheable size.** `ASK_SYSTEM_PREAMBLE` is a few
sentences — likely well under the ~1024–4096 token minimum 018 already documented as
model-dependent and unenforced. Padding it artificially to cross that floor would be
manufacturing a metric to hit a threshold, which is exactly what was ruled out before
starting. If it needs to be larger, that has to come from the preamble actually
needing more words, not from padding.

**Structural correctness was verified; savings were not claimed.** Every test in
`tests/ask-caching.test.mts` checks *shape* — which block carries the breakpoint,
whether the preamble is byte-identical across different questions, whether the nonce
ever leaks into supposedly-stable content. None of them can and none of them try to
assert a dollar amount or a `cache_read_input_tokens` value, because no test can see
that without a live call.

## Not verified

- **No real `cache_read_input_tokens` has been observed** — same seam as 017 and
  018, blocked on the missing credential.
- **Whether `ASK_SYSTEM_PREAMBLE` is even large enough to be cached at all.** This is
  a *second*, independent blocker beyond the credential, and it's worse than 018's
  version of the same problem: `withCachedPrefix`'s breakpoint sits on conversation
  history that **grows** — given enough turns it eventually crosses the minimum.
  `ASK_SYSTEM_PREAMBLE` is fixed-size prose with no mechanism to grow. It may never
  cross the floor, in which case this mechanism is structurally correct and
  functionally inert — a request shaped correctly for a cache that never engages.
  Finding out needs `count_tokens`, itself a credentialed call.

## Status

| Piece | State |
| --- | --- |
| `PASSAGE_RULES` / `passageDelimiterNotice()` split | ✅ Verified (unit tests, `passageInstructions()` output unchanged) |
| `withCachedAskSystem()` — breakpoint on the right block only | ✅ Verified (15 assertions) |
| Preamble byte-identical across different questions | ✅ Verified |
| Nonce/passages never leak into the cached block | ✅ Verified |
| Real cache hit (`cache_read_input_tokens > 0`) | ⬜ Blocked — no credential |
| Preamble crosses the provider's minimum cacheable size | ⬜ Unknown — needs `count_tokens` |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

Per the standing agreement: continue building what doesn't need the credential
rather than stopping here. `ask.tsx`'s frontend state is next — but only if there's
a concrete problem in it worth fixing, not a reflex extraction because `chat.tsx`
got one.
