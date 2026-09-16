# Experiment 025 — Warming the Index Before Anyone Asks

## Objective

Experiment 024 made the *repeat* cost of the notebook index nearly free and left the
*first* one untouched — paid by whichever user arrived first after a deploy, and by CI
on every run, because the workflow cached `node_modules` but not the embedding cache.

## What We Built

| Piece | What it is |
| --- | --- |
| `src/instrumentation.ts` | Starts the index build at server boot — fire-and-forget |
| `db.ts` migration 6 | Moves the embedding cache **out** of the application database |
| `embedcache.ts` → `embeddingDb()` | The cache's own file, `.data/embeddings.db` |
| `pnpm warm` | Builds the cache and exits; idempotent |
| `/api/metrics` → `index` | Reports readiness and cached-vector count |
| CI workflow | Caches the embeddings with `restore-keys`, runs `pnpm warm` first |
| `FORGE_EMBED_BATCH` | Selects batch size, so batched and unbatched can be A/B'd |

## Key Concepts

**`register()` must complete before the server accepts requests.** Next 16's docs say
so explicitly. Awaiting a multi-minute index build there would move the wait from the
first request to *startup itself* — strictly worse, because a server that has not
finished booting cannot tell anyone why. So the hook starts the build and returns;
`/api/ask` answers 503 + `Retry-After` until it lands.

It also runs in the edge runtime, where `node:fs` does not exist, so the import is
dynamic and guarded by `NEXT_RUNTIME === "nodejs"`.

**Derived data and durable state have different lifecycles.** Migration 5 put the
cache in `forge.db` because 015 had already built that file. It was a mistake of
*category*, not schema:

```text
forge.db        users, transcripts, sessions, a financial ledger
                durable · per-deployment · must never be shared or thrown away
embeddings.db   vectors derived from the notebook
                deletable · rebuildable · identical for everyone · safe to cache in CI
```

Keeping them together meant CI could not cache the vectors without also caching a
user table, and nothing could be safely deleted to reclaim space.

**`restore-keys` matters more for a content-addressed cache than for most.** Vectors
are keyed by a hash of their *text*, so a stale cache is not useless — a PR editing one
README gets ~285 hits and one miss. An exact-key-only cache would throw that away on
every documentation change, which is most commits here.

## Observations

### Observed — the separation, visible on disk

After migration 6 and a fresh `pnpm warm`:

```text
.data/
  embeddings.db     630 KB
```

No `forge.db` at all — nothing had needed application state yet. Derived data now
exists independently of it.

### Observed — the separation deleted two bugs rather than fixing them

Experiment 024's test harness *copied* cached vectors into each throwaway server
database. That required creating the table before the server had migrated — which
broke every request — and then forcing the database into existence first.

With the cache in its own file, the test server keeps a throwaway `forge.db` and simply
**points at** the shared `embeddings.db`. Nothing is copied, because nothing needs to
be. The seeding function, and both its bugs, are gone.

### Observed — `pnpm warm` is idempotent

```text
cold   285 chunks indexed · 285 newly embedded     82.8 s
warm   284 chunks indexed ·   0 newly embedded      0.036 s
```

### Observed — the batching A/B, run properly

This experiment is where Experiment 024's withdrawn speed claim got an honest answer.
With `FORGE_EMBED_BATCH` selecting the path, interleaved A/B/A/B, each arm twice:

```text
unbatched  1,061 s  /  996 s      (~17 min)
batched       56 s  /   58 s
```

**~18×.** Within-arm agreement 6% and 4%. The full account — including the 2.6×
figure that was noise pointing the right way — is in Experiment 024's correction.

## Mistakes / Failures

**The measurement machine was not a measurement machine.** Load average ranged from 6
to 324 during this work, with the editor re-indexing files as they changed. A cold
build of unchanged code came in anywhere from 67 s to 197 s. Every timing before the
interleaved A/B was taken under uncontrolled load — which is how 024 came to publish a
number that was not supported.

The fix was procedural, not technical: make the configuration switchable
(`FORGE_EMBED_BATCH`), wait for a quiet window, interleave, repeat each arm.

**Two background measurements were lost to session restarts** before the A/B finally
ran. Worth recording only because it shaped the method: a benchmark that takes 20
minutes has to survive being interrupted, and the script now restores the cache it
deletes so an interrupted run does not leave the project cold.

## Decisions

**Fire-and-forget warm-up, not a blocking one.** Reasoned above.

**Migration 6 drops the table rather than leaving it.** An unused table is a trap for
the next reader, who will reasonably assume something writes to it. Migration 5 stays
exactly as it shipped — append, never edit.

**The cache schema is one exported function**, `createEmbeddingSchema()`, used by both
the cache and the tests. Experiment 024 learned what two copies of a `CREATE TABLE`
cost.

**`pnpm warm` runs as its own CI step, before `pnpm check`**, so no test ever pays for
an index build inside a request.

## Questions

- **CI had never actually run green.** Discovered in Experiment 026 — see there.
- **Nothing prunes stale vectors** from `embeddings.db`. Harmless at 630 KB.
- **`register()` warms the notebook index but not the embedding model for
  `/api/search`**, which loads on first use. That turned out to matter — see 026.

## Status

| Piece | State |
| --- | --- |
| Boot-time warm-up | ✅ Built — fire-and-forget |
| Derived/durable separation (migration 6) | ✅ Verified |
| Seeding function deleted | ✅ Two bugs removed rather than fixed |
| `pnpm warm` | ✅ Verified — 82.8 s cold, 36 ms warm |
| Batching A/B | ✅ **~18×, interleaved, two runs per arm** |
| CI green | ❌ **It never was — see Experiment 026** |

## Next Step

**Experiment 026 — CI Was Never Green.** Pushing this work turned Experiment 022's
"written, never run" workflow into a real one, and its record was three runs, three
failures.
