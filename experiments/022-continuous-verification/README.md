# Experiment 022 — Continuous Verification

## Objective

The project had accumulated five commands that verify different things — `test`,
`e2e`, `eval`, `verify`, plus `tsc` and `lint` — and **nothing ran any of them.**

Every one depended on a person remembering. That is not a hypothetical failure mode
here; it is the one this project keeps hitting:

| Experiment | What went unnoticed |
| --- | --- |
| 012 | A comment claiming a rate limit **that did not exist** |
| 013 | A README whose Status block contradicted its own table, for twelve experiments |
| 021 | An e2e suite that **leaked a server process while reporting success** |

The gap is no longer *what to check*. It is *what makes the checking happen*.

## What We Built

| File | What it is |
| --- | --- |
| `scripts/check.mts` | `pnpm check` — one gate, six checks, cheapest first |
| `.githooks/pre-push` | Runs the gate before anything leaves the machine |
| `pnpm hooks` | Installs it via `core.hooksPath`, so it is version-controlled |
| `.github/workflows/check.yml` | The same gate, on every push and PR |

No new dependencies. No test-runner, no husky, no lint-staged — the gate is a
90-line script that shells out to commands that already existed.

## Key Concepts

**A gate, not a checklist.** The commands all existed. What did not exist was a
single thing that runs them and fails loudly.

**Order by cost, stop at the first failure.** Types (5s) before lint (10s) before unit
(6s) before e2e (16s) before eval (4s). A type error should not wait behind a
sixteen-second end-to-end run, and once something has failed the slower gates would
only produce noise.

**Pre-push, not pre-commit.** A commit is a local checkpoint and blocking it punishes
work-in-progress. A push is the first moment the work becomes someone else's problem.
~38 seconds is affordable there and would not be affordable on every commit.

**Three places, because each has a different hole.** The local gate can be forgotten.
The hook can be bypassed with `--no-verify`, and does not exist on a fresh clone until
someone runs `pnpm hooks` — `core.hooksPath` is local git config, not a tracked file.
CI cannot be skipped and is the only one that does not depend on a person.

**Skipped is not passed.** `verify` spends real money, so it stays opt-in even when a
credential exists (`FORGE_VERIFY=1`). A gate that silently spends is a gate people
disable — and the summary line says `verify: skipped`, never nothing.

## Observations

### Observed — `pnpm check`

```text
forge-ai — check  (6 gates, cheapest first)

  ✓ types     4.7s · the contract between every module
  ✓ lint      9.7s · a red lint hides the next real error
  ✓ test      3.4s · 561 assertions — the pieces
  ✓ e2e      15.8s · 32 assertions — whether the pieces fit together
  ✓ eval      4.0s · retrieval is at recall@3 = 100%, so this can only detect DAMAGE
  — verify         skipped: no ANTHROPIC_API_KEY

  all gates passed  types: ok · lint: ok · test: ok · e2e: ok · eval: ok · verify: skipped
```

~38 seconds for everything the project knows how to check without a credential.

### Observed — the failure path, verified by breaking a test on purpose

```text
  ✗ test      5.9s

    ✗ deliberate failure for Experiment 022  this should stop the gate
    561 passed, 1 failed

  check failed at: test
```

Exit 1, the failing gate's **own output printed in full**, and `e2e` and `eval` never
ran. A gate runner that swallows its children's output makes a failure harder to fix
than no gate at all.

### Observed — the hook fires, confirmed against the real remote

```text
$ git push --dry-run origin main

  ✓ types  ✓ lint  ✓ test  ✓ e2e  ✓ eval  — verify skipped
  all gates passed

To github.com:IsaacKalambo22/forge-ai.git
   6152e89..18622a8  main -> main
```

### Observed — the model cache is *not* where CI would expect it

The embedding model is downloaded at runtime on first use and cached **inside
`node_modules`**:

```text
node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache
23M
```

So `cache: pnpm` in `setup-node` does **not** preserve it — that caches the pnpm
store, which holds the package tarball, not a file the package wrote after install.
Without a separate cache step, every CI run re-downloads 23MB before `eval` and before
the e2e suite's search assertions.

The glob in the workflow was checked against the real tree rather than assumed:

```text
cache glob resolves to 1 path(s):
   node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache
```

### Not verified

- **The GitHub Actions workflow has never run.** It cannot be executed locally. The
  YAML is hand-checked and the one line that could silently do nothing — the cache
  glob — was verified against the real directory, but *"CI passes"* is not a claim
  this experiment can make. It becomes true on the first push.
- **`verify` has never run inside the gate**, for the usual reason.

## Mistakes / Failures

**The gate rendered escape codes as literal garbage in exactly the two places it
matters most.**

*What happened.* The runner writes the gate name as it starts, then overwrites it with
the result using `\r` and `\x1b[K`. On a terminal that is a clean in-place update. The
first time I read the hook's output, it looked like this:

```text
  · types    the contract between every module[K  ✓ types    5.4s · …
  · lint     a red lint hides the next real error[K  ✓ lint    10.8s · …
```

*Why it matters more than a cosmetic bug.* Both consumers of this output are **not
terminals**. A git hook's output is piped, and a CI log is a file. So the two contexts
this gate was built for were the two that rendered worst — and a CI log full of `[K`
is precisely the kind of thing that makes people stop reading CI logs.

*How it was caught.* Reading the hook's own output rather than only running `pnpm
check` interactively.

*The fix.* `process.stdout.isTTY`. On a terminal, progress-then-overwrite; piped,
write nothing until there is a result to write.

*What it taught me.* A repeat of the lesson from Experiment 020, which is why it is
worth recording again rather than shrugging at: **check how output looks to its actual
consumer, not to the author running it by hand.** In 020 that was a blocked report
promising nine answers and buying five; here it was a gate whose output was designed
for a terminal it would almost never run in.

## Decisions

**One script, no framework.** Husky, lint-staged and a test runner would each solve a
part of this. The project has one runtime dependency it did not write, deliberately,
and a 90-line script that shells out to existing commands does the job.

**CI runs `pnpm check` rather than listing the steps again.** If the workflow and the
local gate can disagree, the local gate stops being trusted — and the version people
actually run is the local one.

**`eval` is in the gate even though it can only detect damage.** Experiment 013
recorded that retrieval sits at recall@3 = 100%, so the benchmark is a regression alarm
rather than a gradient. That is exactly what a gate wants. The `why` string in the
output says so, so nobody reads a green `eval` as evidence of improvement.

**`verify` is opt-in even with a credential.** It spends money and it is the only gate
that can fail for reasons outside this repository — a decline, a rate limit, a model
change. Failing a push for that would be wrong.

**Node 24 pinned in CI.** `node:sqlite` does not exist in 20 or 22. Experiment 015
found the runtime/types mismatch the hard way via a stale `@types/node`; pinning it
here keeps the two agreeing.

## Questions

- **`--no-verify` exists and always will.** The hook is a convenience; CI is the
  control. Worth being clear about which is which.
- **A fresh clone has no hook until someone runs `pnpm hooks`.** `core.hooksPath` is
  local config and cannot be committed. A `postinstall` script could set it
  automatically — and a package that reconfigures your git on install is rude. Left
  manual, and documented in the README.
- **Nothing checks that the workflow itself still works.** A broken workflow file
  fails silently on GitHub until someone looks at the Actions tab.
- **The gate does not run `pnpm build`.** `tsc --noEmit` catches type errors, but a
  Next build can fail for reasons type-checking does not — it did not here, and that
  is not evidence it never will.
- **No coverage measurement.** Recorded as deferred since Experiment 012 and still
  deferred; 561 assertions is a count, not coverage.
- **~38s will grow.** The e2e suite dominates and each new route adds to it. At some
  point the gate splits into fast (pre-push) and full (CI).

## Status

| Piece | State |
| --- | --- |
| `pnpm check` — six gates, cheapest first | ✅ **Verified, ~38s, all passing** |
| Failure path: stops, prints, exits 1 | ✅ **Verified by breaking a test on purpose** |
| TTY-aware output | ✅ Verified (after the failure above) |
| `.githooks/pre-push` + `pnpm hooks` | ✅ **Verified with `git push --dry-run`** |
| CI workflow | ⬜ **Written, never run** — becomes real on the first push |
| Model cache path for CI | ✅ Glob verified against the real tree |
| `verify` inside the gate | ⛔ Blocked — no API credential |

## Next Step

**Experiment 023 — Prompt-Injection, End to End.**

With a gate in place, the next gap is a claim the project *asserts* but has never
tested through the front door. Experiment 010 found a real vulnerability and fixed it,
and its defence is verified by unit tests against the vulnerable renderer — 0/4 → 12/12.

But 020's claim list has no entry for it, and `pnpm e2e` does not try a single
injection. Every other security property the project holds — authorization, session
revocation, secret redaction — got an end-to-end assertion in 021. Prompt injection,
the one where the attack arrives inside *data the model reads*, has only ever been
checked against a function.

Most of it is testable without a credential: that retrieved passages are nonce-fenced
on the wire, that a hostile passage cannot forge a delimiter, that injected text
reaches the model as data. Only "does the model actually obey the fence" needs a key —
which makes it a tenth claim for `pnpm verify`, in the place the others already live.
