# Experiment 024 — Making the Index Affordable

## Objective

Experiment 023 set out to test a security defence and surfaced a performance problem
instead: the notebook index took **516.6 seconds** to build, at ~850 MB, **rebuilt from
scratch on every restart** — and it grows with every document written. It was 65 chunks
in Experiment 008.

`/api/ask` and `/api/agent` were effectively unavailable for the first eight minutes
after a restart, and nothing said so. The promise was cached, so the second caller
queued silently behind the first.

Four things to fix, all measurable without a credential:

```text
persist it           embeddings are float arrays; 015 already has SQLite
cache by content     most restarts change nothing — re-embed only what moved
batch the embedding  one call over 256 long texts is where the memory goes
report readiness     a request that waits minutes in silence is a bug
```

## What We Built

| File | What it is |
| --- | --- |
| `db.ts` migration 5 | `embeddings` table, keyed `(hash, model)` |
| `src/lib/embedcache.ts` | Content-addressed vector cache |
| `embeddings.ts` | `embed()` batches at 16 instead of one giant call |
| `knowledge.ts` | Uses the cache; logs `notebook index ready`; `warmIndex()` |
| `/api/ask`, `/api/agent` | **503 + `Retry-After`** while the index builds |
| `tests/embedcache.test.mts` | 30 assertions, injected embedder — no model needed |

Unit suite **593 → 630**. End-to-end **32 → 39**.

## Key Concepts

**Embedding is deterministic**, so it is cacheable: the same text through the same
model always produces the same vector. That is the whole basis of this experiment.

**Content-addressed, not path-addressed.** The key is a hash of the *text*, plus the
model. A section that moves to another file, or shifts down a document as text is
inserted above it, is the same text and must not be re-embedded. Editing one paragraph
should cost one embedding, not 271.

**The model is part of the key.** Vectors from different models are not comparable, and
mixing them produces *meaningless similarities rather than an error* — the worst kind
of failure.

**Batching bounds the peak, because a batch is padded to its longest member.** One
2000-token passage makes every other text in that call the same size. This is why one
call with everything was both the memory peak and, as it turned out, far slower.

## Observations

### Observed — the headline

```text
COLD: {"chunks":271,"cache_hits":0,  "embedded":271,"ms":196787}
WARM: {"chunks":271,"cache_hits":271,"embedded":0,  "ms":71}
```

Repeated later on the same machine under lighter load, and after the corpus grew:

```text
COLD  284 chunks, 0 cached     70.6 s   /   66.9 s
WARM  284 chunks, 284 cached    0.036 s
```

**A warm build is three to four orders of magnitude faster than a cold one.** Every
pairing measured gives at least ~1,000×, and the cache costs 407 KB for 271 vectors.

This is the claim the experiment supports. The spread in the *cold* column — 66.9 s to
196.8 s for the same code — is the machine, not the code. See the correction below.

### CORRECTION — the speedup claim was wrong, and then measured properly

**An earlier version of this README claimed batching cut the cold build 2.6×, from
516.6 s to 196.8 s. That claim was unsound, and the real figure is about 18×.**

*What was wrong with it.* Every cold measurement taken at the time, with what else was
running:

| config | chunks | cold build | RSS |
| --- | --- | --- | --- |
| one call with everything (Exp. 023) | 256 | 516.6 s | ~833 MB |
| batched 16 | 271 | 196.8 s | — |
| batched 16 | 271 | 162.0 s | 424 MB |
| batched 16 | 284 | 70.6 s / 66.9 s | — |
| batched 16 | 285 | 82.8 s | — |

**The batched arm alone spans 66.9 s to 196.8 s — a 2.9× spread, from load only.**
Larger than the 2.6× being attributed to the change. The machine's load average was
observed between 6 and 324 while the editor re-indexed the files being edited, and the
unbatched baseline was measured once, under unknown conditions, and never repeated.

Two contended samples were compared and the difference credited to the code. That is
not an A/B test, whatever number it produces.

*Measured properly.* `FORGE_EMBED_BATCH` now selects the batch size (`0` = one call
with everything), so both paths can be run back to back. Interleaved A/B/A/B, each arm
twice, same corpus of 285 chunks:

```text
unbatched  1,061,242 ms      (17.7 min)
batched       56,082 ms      (56.1 s)
unbatched    995,592 ms      (16.6 min)
batched       58,408 ms      (58.4 s)
```

Within-arm agreement is **6%** and **4%**. Between arms it is **~18×**. The effect is
enormously larger than the noise, which is exactly what the earlier measurement could
not have told anyone.

*And the unbatched path scales worse than linearly.* Experiment 023 measured it at
516.6 s for 256 chunks; here it is ~1028 s for 285:

```text
chunks  +11%   →   time  +99%
```

Consistent with the padding mechanism: total work is roughly *n × longest chunk*, and
adding experiment READMEs grew **both** factors. The single-call version does not just
cost more as the notebook grows — it degrades faster than the notebook does.

*What this does to the earlier conclusion.* The direction was right and the reasoning
was right; the evidence was not. **Being right for bad reasons is still being wrong** —
the 2.6× understated a real 18× effect, and a number that happens to point the right
way is not a measurement. Had batching made no difference at all, that evidence would
have said 2.6× just as readily.

*The lesson, which this project keeps relearning.* Experiment 018 recorded that the
value of an instrument is that it can contradict you. Here the instrument was a wall
clock on a laptop running an editor, and it **agreed** with me — which felt like
confirmation and was noise. A plausible mechanism makes a bad measurement much harder
to doubt.

```text
interleave A/B/A/B            the control for load that drifts mid-run
repeat each arm               one sample per arm is not a comparison
record the conditions         load average, what else was running
make the config switchable    so both paths can be re-run later
distrust an effect smaller than the spread within its own arm
```

The last rule is the one that would have caught this at the time, with no extra runs:
the batched arm varied by 2.9× on its own, so a 2.6× claim was never supportable from
that data.

### Observed — the cached vectors are bit-identical to fresh ones

The unit tests prove the caching *logic* with a fake embedder. This checks the stored
bytes against the real model:

```text
[0] cosine(cached, fresh) = 1.000000000   max component delta = 0.00e+0
[1] cosine(cached, fresh) = 1.000000000   max component delta = 0.00e+0
[2] cosine(cached, fresh) = 1.000000000   max component delta = 0.00e+0
```

Exactly zero, not merely small — the model emits float32 and the BLOB stores float32,
so there is no conversion to lose anything. JSON would have round-tripped through
decimal strings and been both larger and lossy in the last bits.

### Observed — retrieval quality is unchanged

The check that makes the speedup trustworthy. `pnpm eval`, against the numbers
Experiment 018 recorded:

```text
recall@3  (what /api/ask uses)      69%     100%
precision@3                         23%      35%   (ceiling 35%)
MRR                               0.736    0.896
```

Identical. **Faster and not worse** — which had to be demonstrated, not assumed.

### Observed — the route now answers instead of hanging

```text
✓ the test server was seeded with cached embeddings   271 vectors
✓ the first request is answered, not hung             HTTP 503
✓ with an honest error
✓ and a Retry-After header on that same response
✓ once ready, retrieval runs and sources are emitted
✓ the index became ready within 60s of a seeded cache
```

## Mistakes / Failures

**I wrote a test that asserted nothing, and only noticed because I read it back.**

The "embedder returned the wrong number of vectors" case was:

```ts
throws("short result", () => {
  void embedCached(...).catch(() => {});
  throw new Error("Expected 2 vectors, got 1");   // ← my own throw
});
```

It passed. It always would have: the assertion caught an error *this test threw
itself*, while the promise it was supposed to be testing was explicitly discarded.
Rewritten to await the rejection and check the message.

Worth fixing properly rather than deleting, because the case matters: silently zipping
a short result against the hashes would pair vectors with the **wrong texts**, and
retrieval would then be confidently wrong — much worse than a crash.

**Seeding the cache before the server booted broke every request.**

To keep `pnpm verify` usable, the test server copies cached vectors from the dev
database. The first version did that *before* starting the server — creating the
`embeddings` table itself.

Migration 5 is a plain `CREATE TABLE`. It hit the existing table, threw, **the whole
migration chain aborted**, and every request returned `500 Internal server error`. The
symptom was `register alice failed: 500`, which points at auth.

I had even written the hazard down in the comment — *"the server's own migration is a
CREATE TABLE that would then fail, so it must match exactly"* — and then relied on
keeping two schema definitions in sync, which is the thing that hazard describes.

The fix removes the duplicate entirely: seed **after** the server has migrated, and let
the server own its schema.

**And then it seeded zero vectors, silently.**

Moving the seed after startup did not work either: the readiness probe hits
`/api/metrics`, which `guard()` rejects with 401 **before touching the database**. So
at that moment the file did not exist, `existsSync(target)` was false, and seeding
copied nothing — reported as `0 vectors copied`, which only looked wrong because the
e2e assertion printed it.

Fixed by making one failed login request first, which does reach `users` and therefore
opens and migrates the database.

*What the pair taught me.* Both bugs were about **when** a thing exists, not what it
does — and both produced symptoms that named something else (auth, then a slow index).
An ordering dependency that is documented in a comment is still an ordering dependency;
the durable fix was to remove the second schema definition so there was nothing left
to order.

**A third test bug, found by the assertion failing:** I checked for the `Retry-After`
header on a *follow-up* request rather than on the 503 itself. By then the index was
ready and the header was legitimately absent. Reading the status, body and headers from
one response fixed it.

**Not reproduced.** One `pnpm check` run failed with `Server exited during startup`
while my own benchmark was still running in the background. Three consecutive runs
afterwards passed. I could not reproduce it, and I am recording it as unexplained
rather than fixed — the useful outcome is that Experiment 023's fail-fast check
reported the real cause instead of a 60-second timeout.

## Decisions

**SQLite, not a file on disk.** 015 already has it, the vectors are small (407 KB for
271), and a table gets transactions and a primary key for free.

**BLOB of little-endian float32.** Exactly what the model produced. JSON would be ~8×
larger and lossy in the last bits.

**Batch size 16.** Large enough to keep the model busy, small enough that one long
passage does not pad the notebook. Not tuned beyond confirming it is much better than
"all of them" — a sweep would be a separate measurement.

**503 rather than blocking.** The request is not broken and not ready; that is exactly
what 503 + `Retry-After` means. It must be decided before the first byte, since past
that the status is committed (Experiment 004).

**The cache is never invalidated.** A vector keyed by text hash and model cannot go
stale — if the text changes the key changes. Rows for deleted chunks linger, at ~1.5 KB
each. Not worth a cleanup path yet; recorded so it is a decision rather than an
oversight.

## Questions

- **The first build still costs tens of seconds** (66.9–196.8 s observed). The cache removes the *repeat* cost, not
  the first one. A fresh clone, or CI, still pays it — which is why the CI workflow
  caches `node_modules` but would now also want the embedding cache, and does not.
- **Nothing warms the index at startup.** It builds on first request, so the first user
  after a deploy is the one who gets the 503. A warm-up on boot would move the cost to
  where nobody is waiting.
- **Batch size 16 is a guess**, chosen by reasoning about padding rather than by
  sweeping. The right number depends on chunk-length distribution.
- **`/api/search` and `/api/ask` still keep two separate indexes** — `corpus.ts` (16
  hand-written lessons) and `knowledge.ts` (271 notebook chunks). Only the second is
  cached. The first is small enough not to matter, and having two is still odd.
- **Deleted chunks leave rows behind.** Harmless at this size, unbounded in principle.
- **The e2e suite now depends on the dev cache existing** to stay fast. Without it the
  readiness assertions still pass — they poll for 60s — but the suite takes minutes. A
  first-ever run is slow, and that is not obvious from the output.

## Status

| Piece | State |
| --- | --- |
| Migration 5 + `embedcache.ts` | ✅ Verified, 30 assertions |
| **Warm build: tens of seconds → 36–71 ms** | ✅ **Measured, reproduced** |
| Batching halved peak memory (833 → 424 MB) | ✅ Measured once each side |
| **Batching cuts cold build ~18×** (17.7 min → 56 s) | ✅ **Interleaved A/B, 2 runs per arm** |
| The original 2.6× figure | ❌ **Withdrawn — it was noise that pointed the right way** |
| Cached vectors bit-identical to fresh | ✅ **Verified against the real model** |
| Retrieval quality unchanged | ✅ **Verified — recall@3 100%, MRR 0.896** |
| 503 + `Retry-After` while building | ✅ Verified end-to-end |
| Cache seeding for test servers | ✅ Verified — 271 vectors copied |
| First-build cost | ⬜ Unchanged — tens of seconds on a fresh clone |
| Warm-up at startup | ⬜ Open |

## Next Step

**Experiment 025 — Warming the Index Before Anyone Asks.**

024 made the repeat cost nearly free and left the first one untouched: tens of seconds,
paid by whichever user happens to arrive first after a deploy, and paid in full by CI
on every run because the workflow caches `node_modules` but not the embedding cache.

The pieces are small and the measurements already exist:

```text
warm on boot            move the cost to where nobody is waiting
ship the cache          it is 407 KB and content-addressed — it can be committed
                        or cached in CI exactly like node_modules
build it in CI          one job populates it; every later run starts warm
readiness endpoint      /api/metrics already reports latency and spend; index
                        state belongs beside them
```

It also closes a loop from Experiment 022: the CI workflow caches the *model download*
and would now want the *embeddings* too — the same mistake in a second place, which is
the shape of thing worth fixing once and writing down.
