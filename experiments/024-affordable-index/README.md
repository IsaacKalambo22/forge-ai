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

| | Before (023) | After, cold | After, warm |
| --- | --- | --- | --- |
| chunks | 256 | 271 | 271 |
| build | **516.6 s** | **196.8 s** | **0.071 s** |

**196.8 s → 0.071 s on a warm cache: about 2,770× faster.** The cache costs 407 KB for
271 vectors.

### Observed — batching made the cold path faster, not just smaller

This was not the goal. Batching was meant to bound the ~850 MB peak; the cold build
also dropped from **516.6 s to 196.8 s — with 15 more chunks.**

The reason is the padding rule above: in a single 256-text call, every short chunk was
padded to the length of the longest passage in the notebook, and the model did that
wasted work for all of them. Smaller batches mean each text is padded only to the
longest of its 15 neighbours.

**A memory fix that turns out to be a 2.6× speed fix is a sign the original code was
doing work nobody asked for.**

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

- **The first build is still 196.8 seconds.** The cache removes the *repeat* cost, not
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
| **Warm build 196.8 s → 0.071 s** | ✅ **Measured** |
| **Cold build 516.6 s → 196.8 s via batching** | ✅ **Measured, unintended** |
| Cached vectors bit-identical to fresh | ✅ **Verified against the real model** |
| Retrieval quality unchanged | ✅ **Verified — recall@3 100%, MRR 0.896** |
| 503 + `Retry-After` while building | ✅ Verified end-to-end |
| Cache seeding for test servers | ✅ Verified — 271 vectors copied |
| First-build cost | ⬜ Unchanged — 196.8 s on a fresh clone |
| Warm-up at startup | ⬜ Open |

## Next Step

**Experiment 025 — Warming the Index Before Anyone Asks.**

024 made the repeat cost nearly free and left the first one untouched: 196.8 seconds,
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
