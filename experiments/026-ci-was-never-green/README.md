# Experiment 026 — CI Was Never Green

## Objective

Experiment 022 built a gate and a CI workflow, and recorded honestly:

> **The GitHub Actions workflow has never run.** … *"CI passes"* is not a claim this
> experiment can make. It becomes true on the first push.

It was pushed. This experiment is what happened next.

## What happened

```text
42ce071  completed  failure    check
89d3126  completed  failure    check
8a179f1  completed  failure    check
```

**Three runs, three failures. CI had never passed once.** Every local `pnpm check` in
that period was green.

## What We Built

| Piece | What it is |
| --- | --- |
| `scripts/check.mts` → `types` gate | Runs `next typegen` before `tsc` |
| `src/lib/once.ts` | `sharedRetryable()` — share one load, forget a failure |
| `embeddings.ts`, `search.ts`, `knowledge.ts` | All three switched to it |
| `tests/once.test.mts` | 14 assertions, including a witness of the original bug |

Unit suite: **632 → 646.** No new dependencies.

## Finding 1 — the local gate was green because of files CI did not have

No `gh` CLI was available, so the diagnosis went through the public GitHub API. Every
step passed up to and including `pnpm warm`; `pnpm check` failed. The logs need auth,
but check-run **annotations** are public:

```text
[failure] Cannot find name 'LayoutProps'.
```

`LayoutProps` is a Next.js 16 global type, used in `src/app/layout.tsx`. The docs:

> These are globally available helpers, generated when running either `next dev`,
> `next build` or `next typegen`.

They are written into `.next/` and `next-env.d.ts` — **both git-ignored.** Every
developer machine that has ever run `next dev` has them. A fresh checkout does not.

Reproduced exactly with a local clone:

```text
$ git clone . /tmp/forge-ci && cd /tmp/forge-ci && pnpm install
$ ls .next next-env.d.ts
ls: .next: No such file or directory
ls: next-env.d.ts: No such file or directory
$ npx tsc --noEmit
src/app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.
```

**The local gate was only green because of generated files a developer machine happens
to have lying around.** That is precisely the disagreement Experiment 022 warned would
make a local gate untrustworthy — and it was present from the start, invisibly, because
nobody had run the gate anywhere clean.

The fix goes in the gate, not only in CI, so that `pnpm check` on a fresh clone passes
too:

```text
types:  npx next typegen && npx tsc --noEmit
```

Verified the whole CI sequence against a fresh clone — `pnpm install`, `pnpm warm`,
`pnpm check` — all gates green.

## Finding 2 — one dropped connection could permanently break search

Running the gate in a fresh clone *without* `pnpm warm` first produced something else:

```text
e2e — a registered user can sign in and work › search succeeds  got 500, want 200
```

Search worked fine from plain Node on a fresh clone. So the server's own log, found by
the correlation id from Experiment 014:

```json
{"level":"error","msg":"Search failed","request_id":"bbfi57zl","route":"search",
 "status":500,"error":"terminated","stack":"TypeError: terminated
    at Fetch.onAborted (node:internal/deps/undici…)
    at TLSSocket.onHttpSocketClose …"}
{"level":"error","msg":"request","request_id":"bbfi57zl","status":500,"ms":79012}
```

On a fresh deploy, the first search downloads the 23 MB embedding model **inside the
request**, and the connection to the model host dropped after 79 seconds. A transient
network failure — on its own, a retry fixes it.

**Except that nothing ever retried.** All three loaders cached their work like this,
following Experiment 007:

```ts
extractorPromise ??= pipeline("feature-extraction", MODEL);
```

007 chose that so two requests arriving together share one load instead of starting
two. But `??=` only assigns when the value is null — and a **rejected** promise is not
null:

```text
call 1 -> FAILED: network dropped
call 2 -> FAILED: network dropped      ← same stale error
call 3 -> FAILED: network dropped
load() was attempted 1 time(s)         ← the loader would have succeeded
```

**One transient network drop, and search, ask and agent stay broken for the life of
the process.** Only a restart recovers. The pattern was copied three times because it
looked obviously correct.

The fix keeps 007's property and adds the missing one:

```ts
export function sharedRetryable<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error) => { pending = null; throw error; });
    return pending;
  };
}
```

Callers waiting on the failed attempt still see the failure — they were part of it.
The *next* caller starts fresh.

```text
✓ the first call still fails — it WAS a failure
✓ the second call retries and succeeds
✓ four callers, one load                  (007's reason, preserved)
✓ everyone waiting on the failed attempt sees the failure
✓ but it was ONE attempt, not three
✓ and the next call recovers
```

The original bug is kept as a **regression witness** in the test — reproduced, not
described — the pattern from Experiment 010.

## Mistakes / Failures

**Experiment 022 said the right thing and it still went unverified for four
experiments.** "Written, never run — becomes real on the first push" was true and
correctly scoped. What it did not do was make anyone *look* after the push. CI ran
three times and failed three times, and nothing surfaced that, because nothing in the
local workflow reads CI results.

A gate nobody checks is a gate that has not run, as far as the developer can tell. The
difference between "CI exists" and "CI is green" was invisible from the terminal.

**I nearly misattributed the e2e failures.** Reproducing CI, I first ran `pnpm check`
on a fresh clone and got seven e2e failures — then noticed CI runs `pnpm warm` *before*
the gate, and I had not. Run in CI's actual order, everything passed. Chasing those
seven failures as "the CI bug" would have been wrong; they were a *different* bug that
CI's ordering happened to avoid.

That second bug turned out to be the more serious one. **Reproducing a system faithfully
matters, and so does reading the unfaithful run anyway** — it was not CI's problem, but
it was a real one.

**The cached-promise pattern was reviewed and accepted in Experiment 007**, with a
comment explaining exactly why it caches the promise rather than the result. The
reasoning was right about concurrency and silent about failure. A comment that explains
one property well can make the missing one harder to notice.

## Decisions

**`typegen` inside the gate, not a separate CI step.** The point of 022 was that local
and CI run the same command. A fix that lives only in the workflow would recreate the
disagreement it is fixing.

**A shared helper for three call sites.** Three copies of the same bug, each looking
correct in isolation. Fixing it once, with a test, is what stops a fourth copy.

**The model is still downloaded on first use.** `pnpm warm` in CI and
`instrumentation.ts` in production mean it rarely happens inside a request — and when it
does, a failure is now recoverable rather than permanent. Bundling the model is
possible and deferred.

## Questions

- **Nothing tells a developer that CI is red.** No badge, no notification, no `pnpm`
  command that reads it. The most valuable missing piece — the gate only matters if its
  result is seen.
- **Actions are running on deprecated Node 20.** GitHub annotated every run with a
  warning that `actions/checkout@v4` and friends are being forced onto Node 24.
  Non-fatal today.
- **`register()` warms the notebook index but not the `/api/search` model.** That is
  exactly the path that failed here.
- **A retry now happens on the next request, not automatically.** A caller still sees
  the failure. Backoff and an in-process retry are possible and deferred.
- **This is the first real CI result.** Whether the fixed workflow passes is only known
  after the next push — the same honest limit 022 had, one step further on.

## Status

| Piece | State |
| --- | --- |
| Root cause of every CI failure | ✅ **Found — generated types missing on a clean checkout** |
| `typegen` in the `types` gate | ✅ Verified against a fresh clone, full CI sequence |
| Cached-rejection bug | ✅ **Found, witnessed in a test, fixed in all three modules** |
| Concurrent callers still share one load | ✅ Verified |
| CI green on GitHub | ⬜ **Unknown until the next push** |
| Visibility of CI results | ⬜ Open — the gap that let this last four experiments |

## Next Step

**Push, and read the result.** This experiment cannot close its own status line from the
terminal: the fix is verified against a faithful local reproduction, and the real
answer is on GitHub.

After that, the lesson here points at one concrete gap — **CI results are invisible
from where the work happens.** A `pnpm ci-status` that reads the latest run for `HEAD`,
or a README badge, is small, and it is the difference between a gate that runs and a
gate anyone notices failing.
