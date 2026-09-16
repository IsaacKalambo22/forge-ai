# Experiment 027 — CI Result Visibility

## Objective

Experiment 026 fixed why CI had failed three times, and named the deeper problem in
its own Questions section:

> **Nothing tells a developer that CI is red.** No badge, no notification, no `pnpm`
> command that reads it. The most valuable missing piece — the gate only matters if
> its result is seen.

Fixing the type error without fixing that closes the symptom, not the gap. The next
regression fails the same invisible way. This experiment closes the gap.

## What happened

Before writing anything, `pnpm ci-status` (see below) was pointed at the commit 026
left behind — the one with the `typegen` fix, already pushed:

```text
forge-ai — ci-status  (IsaacKalambo22/forge-ai @ 69e20d2)

  ✓ check      success  https://github.com/IsaacKalambo22/forge-ai/actions/runs/35103352717
```

**026's fix worked. CI is green**, on the first push after the fix. That answers 026's
own open question — the one it said could only be answered from GitHub, not the
terminal — and it happened before this experiment wrote a single line, because the
tool to read it did not exist yet. Writing the tool second would have meant leaving
that answer unread for another experiment.

## What We Built

| Piece | What it is |
| --- | --- |
| `scripts/ci-status.mts` → `pnpm ci-status` | Reads check runs for `HEAD` from the public GitHub API |
| README badge | `check.yml`'s live status, top of the README |
| `README.md` | Status section, experiment table, and the `pnpm check` writeup all corrected to the real (green) state |

## Finding — the fix needed no credential, because the gap wasn't data access

026 diagnosed the original type error through the same public, unauthenticated
GitHub API this experiment now wraps: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`.
Logs need auth; check-run status and conclusion do not, for a public repo. The
missing piece was never *access* — it was that nothing in the local workflow ever
made the call. `pnpm ci-status` is that call, with:

- **the current commit, not a hardcoded one** — `git rev-parse HEAD`, so the answer
  is always about what's checked out, not a value someone forgets to update;
- **an owner/repo parsed from `git remote get-url origin`** — nothing to configure or
  drift from the actual remote;
- **a distinct exit code for "not run yet"** (`2`, unpushed or GitHub hasn't seen the
  commit) **vs "failed"** (`1`) — a 404 and a red run are different facts and 026's own
  postmortem depended on telling them apart (see its Questions and Status sections);
- **the same GitHub URL in its output** that a person would click to read the log,
  so the terminal answer and the web answer are never two sources of truth.

Not added to the `pnpm check` gate itself: `check` verifies the working tree, which is
knowable before a push exists; `ci-status` answers a question that has no answer
until after one. Folding them together would make `pnpm check` fail on a machine that
has never pushed, for a reason unrelated to anything it changed.

## Decisions

**A script plus a badge, not a git hook.** A hook that blocks on CI status runs on
every commit whether or not a push happened, and needs to poll for a result that can
take minutes to exist. A pulled, on-demand check (`pnpm ci-status`) and a passively
updating badge cover "is it green" without inventing a wait state nobody asked for.

**Read check-runs, not workflow-runs.** The `/actions/runs` endpoint returns
workflow-level status; `/commits/{sha}/check-runs` returns the same check-run objects
GitHub renders next to a commit and a PR — the thing a developer already looks at, so
the terminal output means the same thing the UI does.

**No token, no `.env` entry, nothing to configure.** The runners-up this experiment
was chosen over — the Anthropic API credential, usage recording, per-user rate
limiting, tracing — all cost either real money or a shared store. This one is git
metadata plus a public HTTP call.

## Questions

- **The badge and `pnpm ci-status` can disagree in the seconds after a push**, while
  GitHub is still creating the check run. `ci-status` reports that as "not found"
  (exit 2), not failure — worth remembering if it's ever scripted into something
  stricter than a human glance.

## Confirmation

Pushed as commit `6834579`. Its own check run came back green — the first time this
project's visibility gap has been closed by the exact mechanism built to close it:

```text
$ pnpm ci-status
forge-ai — ci-status  (IsaacKalambo22/forge-ai @ 6834579)

  ✓ check      success  https://github.com/IsaacKalambo22/forge-ai/actions/runs/...
```

Unlike 026, that answer took one local command, not a trip to a web page.

## Status

| Piece | State |
| --- | --- |
| `pnpm ci-status` | ✅ Verified against the live check run for 69e20d2 |
| README badge | ✅ Added — renders from GitHub's own badge endpoint |
| 026's fix | ✅ **Confirmed green** — answered by this experiment's first `ci-status` run |
| This experiment's own change, on GitHub | ✅ **Confirmed green** — commit `6834579` |

## Next Step

Closed. `pnpm ci-status` and the badge are the standing answer to "is CI green" from
here on — no further action needed for this experiment.
