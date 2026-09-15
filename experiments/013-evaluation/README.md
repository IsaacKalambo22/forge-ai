# Experiment 013 — Evaluation

## Objective

How do we determine whether an AI feature actually works well?

Experiment 008 declared RAG retrieval "verified" on the strength of a hand-check:
top-4 went from 5/7 to 7/7 on a few queries I typed while watching the output. That
is not a measurement. It has no denominator, no baseline, no record, and it cannot
tell me tomorrow whether a change made retrieval better or worse.

This experiment replaces that with a number that moves.

**Constraint that shaped everything:** there is still no Anthropic API credential.
Generation quality cannot be measured. Retrieval quality can — because Experiment 007
put the embedding model in this process instead of behind a paid API. The experiment
was chosen to fit the half of the system that is actually observable.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/metrics.ts` | recall@k, precision@k, reciprocal rank, mean. Pure, no imports. |
| `src/lib/evalset.ts` | 16 labelled queries over the 16-lesson corpus. |
| `tests/metrics.test.mts` | 32 assertions, every expected value computed by hand. |
| `tests/evalset.test.mts` | 7 assertions on the benchmark's own integrity. |
| `scripts/eval-retrieval.mts` | The benchmark. `pnpm eval`. |

Test suite: **160 → 199 assertions.**

## Architecture

The benchmark sits beside the application and calls the same retrieval path the app
calls. It does not reimplement it — a benchmark that scores its own private copy of
the retriever measures the copy.

```text
scripts/eval-retrieval.mts
   │
   ├─→ evalset.ts        16 queries + human labels
   ├─→ metrics.ts        pure arithmetic, separately tested
   │
   ├─→ searchLessons()   ← THE SAME function /api/ask uses
   │      └─→ embeddings.ts   local model, no key, no network
   │
   └─→ lexicalRanking()  ← the control, defined in the script only
```

`pnpm eval` is separate from `pnpm test` deliberately. It loads a real model and takes
seconds; the unit suite must stay fast enough to run constantly. A slow benchmark
folded into a fast suite gets skipped, and a skipped benchmark measures nothing.

## Key Concepts

**Evaluation set (or "eval set").** A fixed list of inputs paired with human
judgements about what a correct output looks like. The judgements are the expensive
part and the whole value: metrics are arithmetic, labels are opinion.

**recall@k** — of the answers that exist, what fraction appeared in the top k?
*Did we find it.* Raising k can only ever raise recall, so recall alone is never
enough: return the whole corpus and score 1.0.

**precision@k** — of the k things returned, what fraction were correct?
*Did we return junk.* The counterweight. Returning everything makes recall 1.0 and
precision near zero.

**MRR (mean reciprocal rank)** — average of 1/(rank of the first correct answer).
Rank 1 scores 1.0, rank 2 scores 0.5, rank 4 scores 0.25. The steep drop is the
point: a correct passage at rank 8 is nearly as useless as an absent one, because
the application only sends the top k to the model.

**Baseline.** A deliberately naive alternative scored on the same set. Without one,
"MRR 0.896" is a number with nothing to compare against and cannot answer the only
question that matters — is the embedding model earning its complexity?

**Ceiling.** The best score a metric can attain given the labels. Most queries here
have exactly one relevant lesson, so precision@3 cannot exceed 1/3 for them. Printing
the ceiling stops 35% being misread as a failure.

## Implementation

Three decisions worth recording.

**Metrics are pure and separately tested.** Same pattern as `expression.ts` and
`vector.ts`: no imports, no privileges. Every expected value in the test is computed
by hand in the label — `k=4 finds b and d → 2/2`. A metric you cannot check on paper
is not a measurement, it is a rumour. If the benchmark ever disagrees with intuition,
the metrics are not the suspect.

**The metrics throw rather than coerce.** `k=0`, fractional `k`, `k` beyond what was
retrieved, a query with no labels, duplicate ids in a ranking — all throw. Duplicates
in particular would silently inflate recall, and they can only come from an index bug.

**Labels were written before the retriever was ever run against them.** Adjusting
labels after seeing output is how a benchmark quietly becomes a mirror.

## Testing

```bash
pnpm test     # 199 assertions, no model, fast
pnpm eval     # the benchmark — loads the embedding model
```

## Observations

```text
  rank of first correct answer (1 is best, · = not retrieved)

  query                                                       lex  dense
  ---------------------------------------------------------- ---- ------
  Why can't I just put my API key in the React component?       1      1
  I got back an object instead of a string and can't pri…*      1      1
  Is checking the input myself worth it before calling t…*     10      3
  Why did my browser bundle suddenly balloon after addin…*      1      1
  Should I let users write their own system prompt?             1      2
  I want the compiler to stop me shipping backend code t…*      6      1
  Does the API remember what we talked about last time?*        1      1
  Why does my bill grow so fast in long conversations?          1      1
  Could someone fake a previous reply in the transcript …       1      1
  I can't send an error status once the response has sta…       1      1
  My JSON parsing fails at random while reading the stre…       1      2
  Does the model actually see the notes I put on each fi…       1      1
  I found the string in a build file — does that prove i…       4      1
  Is it safe to run the expression the model produced?          5      1
  How much should I trust the arguments the model genera…       1      1
  My agent keeps going round and round and won't stop*         16      1

  * = deliberately low word overlap with its answer

  metric                          lexical    dense
  ------------------------------ -------- --------
  recall@1                            69%      78%
  recall@3  (what /api/ask uses)      69%     100%
  recall@5                            78%     100%
  precision@3                         23%      35%   (ceiling 35%)
  MRR                               0.736    0.896

  dense MRR on low-overlap queries : 0.889  (6 queries)
  dense MRR on the rest            : 0.900

  0 of 16 queries would miss at the k=3 the app actually sends.
```

**Observed — retrieval is sound at the k the application uses.** recall@3 is 100%.
Every query's correct lesson is inside the top 3, which is what `/api/ask` sends.

**Observed — precision@3 sits exactly on its ceiling (35%).** Consistent with
recall@3 = 100%: every relevant lesson that *could* be in the top 3 is.

**Observed — the embedding model earns its complexity, but not evenly.** MRR 0.896
vs 0.736 lexical. The interesting part is *where*. On the twelve queries with normal
word overlap, lexical is already competitive — it gets rank 1 on ten of them. The gap
opens entirely on paraphrase.

**Observed — the single clearest result in this experiment:**

```text
"My agent keeps going round and round and won't stop"
            lexical → rank 16 of 16 (dead last)
            dense   → rank 1
```

The lesson it should match says *"Cap the agentic loop's iterations… An uncapped loop
is a denial-of-service you perform on yourself."* It shares **no content words at all**
with the query. Lexical search cannot rank it above chance; it ranked it worst
possible. The embedding placed it first. This is what "semantic" means, demonstrated
rather than asserted — and it is why a vector index exists at all.

**Observed — paraphrase costs the dense retriever almost nothing.** MRR 0.889 on the
deliberately-low-overlap queries against 0.900 on the rest. A gap of 0.011. That
robustness is the specific property being bought.

**Observed — the dense retriever's weakest query.**

```text
"Is checking the input myself worth it before calling the model?"  → rank 3
```

Its answer is the lesson about validation being ~50× cheaper than a provider
rejection. The query asks about *worth*; the lesson is phrased in *milliseconds and
round trips*. The embedding partly bridges that, but not confidently. A question
about whether something is worthwhile and an answer expressed as latency numbers are
not near neighbours in this model's space.

## Mistakes / Failures

**My own integrity test caught me writing a dishonest benchmark.**

*What happened.* `evalset.test.mts` asserts that no query copies more than half its
content words from the lesson it is labelled against. On first run it failed, naming
four of my sixteen queries.

*What I expected.* To have followed my own rule — I had written it in a comment at
the top of the same file.

*What actually happened.*

```text
✗ no query copies more than half its content words from the answer
  "Importing one constant shipped my whole SDK to the browser";
  "How do I turn a silent leak to the client into a build error?";
  "Can the client lie to me about what the assistant said?";
  "Do the descriptions I write in my schema reach the model?"
```

The first is near-verbatim from its lesson: *"A client component importing one string
from the same file as the SDK shipped the entire SDK."*

*Why it happened.* I wrote the queries immediately after reading the corpus. The
lessons' phrasing was the phrasing in my head. This is the standard way eval sets go
bad, and knowing about the failure mode did not prevent me committing it — I wrote the
warning and then broke it within the same hour.

*How we diagnosed it.* The test named all four offenders on the first run.

*How we fixed it.* Rewrote the four as questions phrased from the symptom rather than
the answer, and marked two of them `hard`. `"Importing one constant shipped my whole
SDK to the browser"` became `"Why did my browser bundle suddenly balloon after adding
one import?"`.

*What the failure taught me.* The scores would have been **better** with the leaky
queries in, and every one of those extra points would have been a lie — measuring
string overlap, not retrieval. A benchmark is code that reports on itself, so it needs
tests more than ordinary code does, not fewer. The only reason this was caught is that
I wrote the check before running the benchmark; had I run it first and seen good
numbers, I would have had no reason to look.

## Decisions

**A naive lexical baseline, in the script only.** It is the control, not a candidate
implementation, so it does not belong in `src/lib`. Without it the dense numbers are
unfalsifiable. With it, "is the model doing anything?" has an answer — yes, on
paraphrase, by a wide margin, and barely otherwise.

**No evaluation framework.** Per the no-premature-abstraction rule: the whole
benchmark is ~120 lines and one dependency-free metrics module. Nothing here needs a
harness, an LLM judge, or a tracking service yet.

**No LLM-as-judge.** It would need the API credential this project does not have, and
it would measure generation, which is the part that cannot yet be observed at all.
*Deferred.*

**Benchmark separate from the test suite.** Fast things run constantly; slow things
run deliberately.

## Questions

- **The set is 16 queries over 16 lessons, all written by the person who wrote the
  corpus.** That is small enough that one query moving changes MRR by ~0.06, and
  biased in the way every self-labelled set is. It detects regressions; it does not
  establish absolute quality. *Not fixable without an outside labeller.*
- **recall@3 is 100%, so this benchmark can no longer detect improvement — only
  damage.** A ceiling-bound metric is a regression alarm, not a gradient. Making it
  discriminating again needs harder queries or a bigger corpus. *Next time the corpus
  grows.*
- **Retrieval is not the application.** The model still has to use the retrieved
  passage correctly. Measuring that needs a credential. *Blocked.*
- **Chunking is unmeasured.** `chunk.ts` splits the notebook for `/api/ask`, and this
  benchmark runs over the hand-written `corpus.ts` instead. Chunk size and overlap are
  currently set by judgement with no number attached. *Deferred — the obvious next
  use of this harness.*
- **One embedding model, never compared.** `all-MiniLM-L6-v2` was chosen in 007 for
  size. There is now a harness that could compare it against alternatives, and no
  measurement has been taken. *Deferred.*

## Status

| Piece | State |
| --- | --- |
| `metrics.ts` + 32 assertions | ✅ Verified — every value hand-computed |
| `evalset.ts` + integrity tests | ✅ Verified — caught a real defect in itself |
| `pnpm eval` benchmark | ✅ **Verified end-to-end, no API key required** |
| Retrieval quality at k=3 | ✅ **Measured: recall@3 100%, MRR 0.896** |
| Generation quality | ⛔ Blocked — no API credential |
| Chunking quality | ⬜ Deferred — harness exists, unused |

## Next Step

**Experiment 014 — Observability.** Evaluation answers "is it good?" offline on a
fixed set. It says nothing about what happens on a request nobody labelled. The
paired question is "what is it actually doing in production?" — structured logs,
latency percentiles, token counts per request, and a correlation id.

That last one closes a debt from Experiment 001, still recorded in the README: the
route forwards the provider's raw error text to the client, which leaks the provider
in production. The fix was deferred pending somewhere to put the real error. Logging
is that somewhere.

Observability is also mostly measurable **without** an API credential — latency,
status codes and retrieval timings are all real today.
