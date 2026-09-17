# Experiment 039 — Making `indexReady()` Actually Cross-Layer

## Objective

README's Deferred list has carried this since Experiment 034:

> `instrumentation.ts` and each Route Handler still have separate module instances
> of `knowledge.ts`'s `indexBuilt` flag (Next.js's per-layer bundling) — the
> user-facing symptom (a spurious 503 on a route layer's first request) is fixed,
> but the flag itself still doesn't agree across layers, which is why `/metrics`'s
> index badge can still show stale "Building".

034 deliberately left this alone — its own comment says the fix for the REQUEST-503
problem was a bounded wait, not making `indexBuilt` cross-layer, "a bigger change."
This experiment is that bigger change, scoped down to the one place it was actually
needed: `indexReady()`, `/metrics`'s badge, and nothing else.

## What happened — the bug was worse than "cosmetic staleness"

Checked which routes actually call anything that builds the index in their own
module instance. `/api/ask`, `/api/agent`, `/api/search` all call `retrieve()` →
`getIndex()`. `/api/metrics` calls neither — it only ever read `indexReady()`,
which just returns its own layer's `indexBuilt`. Since nothing in `/api/metrics`'s
own module instance ever sets that flag true, the old `indexReady()` could report
"Building" **forever** on that layer, not just for a few hundred milliseconds after
boot — "stale" undersold it.

## What We Built

`src/lib/knowledge.ts`'s `indexReady()` no longer trusts its own module instance's
`indexBuilt` alone. It falls back to asking the embedding cache — SQLite, shared by
every layer since Experiment 025 — whether every hash the *current* corpus needs is
already stored:

```text
indexBuilt (this layer)?        → true, done, cheapest path
otherwise: hash every current chunk, check embedCache.lookup() has all of them
```

A raw count comparison (`cached_vectors >= total_chunks`) was tempting and wrong:
`embeddings` has no purge (024 never needed one), so an edited or removed
experiment leaves orphaned rows that could make a stale count look sufficient by
accident. Checking hash PRESENCE, not just count, is what `getIndex()` itself
would effectively check to know whether it would be a 100% cache hit — reusing that
exact question rather than inventing an approximation of it.

`src/lib/embedcache.ts` gained one line: `embedCache.lookup`, a thin wrapper over
the already-tested pure `lookup()` function, matching the existing `get`/`count`
shape.

## Verified live

Unit-testing this honestly would mean either touching the real `.data/embeddings.db`
(what `embedcache.test.mts` already goes out of its way to avoid, injecting the
database everywhere else) or refactoring `loadSources()` to accept an injectable
corpus root — a bigger change for a function whose whole design already reads the
REAL `experiments/` directory. Consistent with how 033/034/035 verified their own
cross-layer and timing fixes, this was checked against a real server instead:

```text
fresh server, empty FORGE_EMBED_DB_PATH, mid cold-build (instrumentation.ts's OWN
layer building — /api/metrics never calls getIndex() itself):

  GET /api/metrics → index: { ready: false, cached_vectors: 0 }

~80s later, instrumentation.ts's warm-up finishes (393 chunks, 0 cache hits — a
genuinely cold embed, not a cache hit skewing the result):

  GET /api/metrics → index: { ready: true, cached_vectors: 393 }
```

`/api/metrics`'s own module instance never ran `getIndex()` at any point in this
run — `ready` flipped true purely from reading what a *different* layer had written
to the shared cache. That is the specific property that was broken before, and the
one this experiment set out to fix.

## Decisions

**Fix `indexReady()` in place, not add a second function.** It had exactly one
real caller (`/api/metrics`'s `ready` field) and its docstring already scoped it to
that use. A second, cross-layer-safe function alongside it would have been the
"complete" shape other dual-path modules use — and dead weight for a function this
narrowly used.

**Hash presence, not a count comparison — see above.** Recorded here as the decision
it was, not folded silently into the diff: the count-comparison version would have
passed every test written against a freshly-seeded cache and only shown its false
positive on a real repo with real edit history, which is exactly the kind of bug
this project's testing philosophy (fixture-based, not test-the-happy-path-only)
exists to catch before it ships.

**No `knowledge.test.mts`.** Same reasoning Experiment 036 gave for `guard.ts`:
the actual fix touches a module coupled to a real singleton (`embeddingDb()`) and
real disk state (`loadSources()` reads the repo's own `experiments/` directory),
with no injectable seam. Building one here would be a second, larger experiment;
verifying live, the same way 034 verified its sibling fix, was the smaller and
more honest choice for what this experiment actually needed to prove.

## Status

| Piece | State |
| --- | --- |
| `indexReady()` reads the shared embedding cache when this layer's own flag is false | ✅ Verified live — see above |
| Hash-presence check avoids the orphaned-row false positive a count comparison would have | ✅ Reasoned and documented; not independently regression-tested (see Not verified) |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass — 854 assertions, unchanged (no new unit coverage this experiment — see Decisions) |

## Not verified

- **The orphaned-row scenario itself.** Reasoned about, not reproduced: this repo's
  real `.data/embeddings.db` does not currently have enough edit/deletion history
  to construct a case where the discarded count-comparison approach would have
  actually returned a false positive. The hash-presence fix is correct by
  construction (it checks the literal query `getIndex()` needs, not a proxy for
  it), not because the failure mode it avoids was independently confirmed.

## Next Step

No queued item. This closes the last item Experiment 034 explicitly deferred.
Remaining gaps are the ones already on record: generation-phase latency, blocked
on the credential, and the still-open questions in Experiment 020's `pnpm verify`.
