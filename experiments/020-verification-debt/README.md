# Experiment 020 — Closing the Verification Debt

## Objective

Seven experiments end with the same sentence. The blocked list stopped being a
footnote some time ago:

```text
001  is `content` really an array of blocks?  does max_tokens flip stop_reason?
002  do personas actually change model behaviour?
005  does the model conform to the schema?
006  does the tool loop ever execute?
009  does the agent loop ever execute?
017  is a ledger row ever written from a live `usage` object?
018  does the cache ever actually hit?
019  what does keepRecent = 3 cost in answer quality?
```

Two of these are now **load-bearing**. Experiments 018 and 019 made *decisions* on
projected numbers, and 018's own note says a cache that silently never hits costs
1.25× while looking fine.

Adding a twenty-first feature on top of that would be building on unverified ground.
This experiment builds the thing that converts a credential into answers.

> The insight that shaped it: **"blocked" and "unbuilt" are different states, and the
> project had been conflating them.** Most of each blocked claim is not the API call.
> It is knowing what would settle the question — and that part can be built and tested
> today.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/claims.ts` | 9 claims as data: question, required evidence, and a **pure evaluator** |
| `scripts/verify-live.mts` | `pnpm verify` — gathers evidence and reports verdicts |
| `tests/claims.test.mts` | 54 assertions — every evaluator, three ways |

Test suite: **499 → 553 assertions.** New runtime dependencies: **none.**

## Architecture

The split is the entire design:

```text
EVIDENCE                          EVALUATOR
what a live call produces         whether that evidence settles the claim
needs a credential                PURE — tested against fixtures TODAY
        │                                   │
        └──────── pnpm verify ──────────────┘
```

So the part with reasoning in it — the part that can be *wrong* — is verified now.
Acquiring a key only supplies the input. Without that split, "run it when you have a
key" would mean shipping nine untested judgements and discovering their bugs at the
same moment as the answers.

## Key Concepts

**A claim is data, not code.** Id, the experiment it settles, the question *as that
experiment recorded it*, the evidence required, and an evaluator. Listing them is then
possible without running anything — which is most of the value today.

**Three verdicts, not two.** `pass`, `fail`, and **`unusable`**. Malformed or missing
evidence is not a failed claim, and reporting it as one would manufacture a finding
out of a broken fetch. Every evaluator returns `unusable` rather than throwing,
because *a harness that crashes on a surprising response has told you nothing*.

**Evaluators must be able to fail.** Each is tested against evidence of the specific
regression its experiment predicted. An evaluator that can only return `pass` is not
an evaluator, and that is easy to write by accident.

**Coverage is declared, not discovered.** Each claim records whether its evidence
comes from a direct API call (`sdk`) or needs the running application (`app`). The
harness reports `5 of 9 gathered` *before* it runs rather than printing four silent
dashes at the end.

## Testing

```bash
pnpm test      # 553 assertions, including all 9 evaluators
pnpm verify    # the debt table today; the answers when a key exists
```

## Observations

### Observed — `pnpm verify` with no credential

```text
forge-ai — live verification
9 claims across 8 experiments

  No ANTHROPIC_API_KEY. Nothing below has been observed.

  A Claude.ai or ChatGPT subscription is NOT an API credential — they are
  separate accounts with separate billing. A key looks like sk-ant-...

  ? 001-content-blocks       Is `content` really an array of typed blocks…?
      needs: One Message response.
  ? 002-personas-change-behaviour   Does a system instruction actually change…?
      needs: Two answers to the SAME question, one under `default`, one `terse`.
  …

  9 claims blocked. The evaluators for all of them are unit-tested
  against fixtures — run `pnpm test`. Only the evidence is missing.

  Coverage of this harness: 5 of 9 are gathered by a direct API call.
  The other 4 need the running application and are NOT yet gathered:
    - 005-schema-conformance
    - 006-tool-loop-executes
    - 009-agent-loop-executes
    - 019-pruning-preserves-citations
```

This is the project's honest inventory, generated rather than maintained by hand —
which matters, because a hand-maintained blocked list is exactly the kind of thing
that drifts (see Experiment 013, where the README contradicted itself).

### Observed — the credential path is real, verified with a deliberately invalid key

```text
$ ANTHROPIC_API_KEY=sk-ant-not-a-real-key pnpm verify

  Failed while gathering evidence: 401 {"type":"error","error":
  {"type":"authentication_error","message":"API key is invalid."}}
  exit 1
```

Not a simulation. Real HTTP to `api.anthropic.com`, a real 401, a nonzero exit. The
key-shape detection, the gather path, and the error handling are all exercised — only
the *successful* branch is not.

### Observed — every evaluator fails on the regression its experiment predicted

The evaluators are only useful if they can return `fail` for the right reason. Each is
tested against a fixture of the exact failure its experiment warned about:

```text
✓ a bare string fails — that was the 001 surprise
✓ no difference fails                          (002: the persona changes nothing)
✓ null parsed_output fails                     (005: the output did not validate)
✓ a tool_use with no result is reported as an unclosed loop      (006)
✓ steps without a stopped event fails          (009: did not exit through decide())
✓ an unpriced billable field fails … and says totals are a lower bound   (017)
✓ written but never read is a FAIL … detail says the premium is wasted   (018)
✓ an answer citing nothing fails … points at keepRecent                  (019)
```

The 018 one is the one to read twice. Its failure detail:

```text
5000 tokens WRITTEN but 0 read — paying 1.25x for nothing.
Either the prefix is changing, or it is below the minimum cacheable size.
```

That is the silent failure 018 could only warn about in prose, now a verdict with both
suspects named.

### Observed — every evaluator survives hostile input

```text
✓ 001-content-blocks survives hostile input
✓ 002-personas-change-behaviour survives hostile input
… all 9
```

Fed `null`, `undefined`, `42`, `"text"`, `[]`, `{}`, `[null]` and nested empties. None
throws.

### Not verified

- **No claim has a `pass` from real evidence.** Every verdict above comes from a
  fixture. That is the entire point of the experiment and it remains true at the end
  of it: this experiment did not *close* the debt, it made the debt **redeemable in one
  command**.
- **The successful branch of `gather()` has never run.** It is straightforward SDK
  usage, and it is the only part of this experiment with no test behind it.
- **The four `app` claims are not gathered at all.** They need a dev server, a session
  and a database. Declared rather than hidden, and the next increment.

## Mistakes / Failures

**I built a harness that quietly covered five of nine claims and reported it only at
the end.**

*What happened.* The first runner iterated all nine claims, found evidence for five,
and printed `— not gathered by this harness yet` for the rest, followed by
`5 passed, 0 failed, 4 not gathered`.

*Why that is worse than it looks.* The line was accurate, and it appeared **only in
the live path** — the path that needs a credential nobody has. The no-credential
output, which is the only output anyone can currently see, listed all nine claims with
no hint that four of them would not be attempted. Someone reading it would reasonably
conclude a key buys nine answers. It buys five.

*How it was caught.* Reading the blocked output as a user rather than as its author,
and noticing it made a promise the code did not keep.

*The fix.* `source: "sdk" | "app"` on every claim, asserted in the tests, and the
coverage printed in the blocked report — before the run, not after.

*What it taught me.* This experiment exists because the project had been conflating
"blocked" with "unbuilt", and my first version of the fix committed a version of the
same error: presenting partial coverage as though it were complete. **An honest
inventory has to be honest about itself**, and the place to state a limitation is
where the reader forms the expectation — not where the code discovers it.

## Decisions

**Claims as data with pure evaluators, rather than a script of assertions.** It is
what makes them testable without a credential, and it makes the blocked list
generated rather than hand-maintained. A hand-maintained list drifts — 013 found the
README contradicting itself for exactly that reason.

**Three verdicts, including `unusable`.** Collapsing it into `fail` would manufacture
findings from broken fetches, which is the opposite of what this harness is for.

**One shared basic call serves two claims.** `001-content-blocks` and
`017-live-usage-row` read different parts of the same response. Each API call costs
money, so the harness reports its own spend using the Experiment 017 pricing module:
`cost of this run: $0.00xx`.

**The cache probe pads its prefix past the minimum cacheable size.** Below it the API
silently does not cache, which would render as a `fail` and be wrong — the mechanism
would be fine and the *probe* broken. A test that can fail for a reason unrelated to
its claim is worse than no test.

**`max_tokens: 16` on one probe, deliberately.** Everywhere else a low ceiling is a
mistake; here truncation is the thing being observed.

## Questions

- **The four `app` claims need the application, not just the SDK** — a dev server, a
  session cookie, and NDJSON parsing. That is the natural next increment and would
  take coverage to 9 of 9.
- **`002-personas-change-behaviour` tests length, not quality.** "Terse is shorter" is
  weak, and deliberately so: it cannot pass by accident. Whether the *engineer*
  persona actually explains better needs a judge, which is Experiment 013's harness
  plus a credential.
- **No claim covers prompt injection (010).** The defence is verified by unit tests
  against the vulnerable renderer, but whether a real model resists a real injected
  instruction has never been observed. It belongs on this list and is not on it.
- **The project does not use server-side refusal fallbacks.** Anthropic's guidance is
  to include `fallbacks` by default on `claude-opus-5` so a policy decline is retried
  on another model. This project sets it nowhere — and for the *verification harness*
  a silent fallback would actively corrupt the evidence, since a different model would
  be answering. Worth a deliberate decision for the app rather than an omission.
- **A run costs real money and the harness cannot say how much in advance.** It
  reports spend afterwards. `count_tokens` would let it estimate first — the same
  missing piece 017's reservation-based budget cap needs.
- **Nothing re-runs this.** A verified claim can silently regress. It is a command
  someone has to remember, not a gate.

## Status

| Piece | State |
| --- | --- |
| 9 claims, with the questions their experiments recorded | ✅ Verified |
| All 9 evaluators, pass / fail / unusable | ✅ Verified, 54 assertions |
| Every evaluator survives hostile input | ✅ Verified |
| No-credential debt report | ✅ **Verified — it is the useful output today** |
| Coverage declared before the run | ✅ Verified (after the failure above) |
| Credential detection + error path | ✅ **Verified with a real 401** |
| The successful `gather()` branch | ⛔ Blocked — no API credential |
| Any claim passing on real evidence | ⛔ Blocked — the point of the experiment |
| The 4 `app` claims | ⬜ Next increment |

## Next Step

**Experiment 021 — Gathering the `app` Claims.**

Take `pnpm verify` from 5 of 9 to 9 of 9. It needs the harness to drive the running
application rather than the SDK: start a server, register and log in a user, POST to
`/api/chat` and `/api/agent`, parse the NDJSON streams, and read the usage ledger back
out of SQLite.

Worth doing for a reason beyond coverage: those four claims are the ones that exercise
the code this project actually *wrote* — the tool loop, the agent loop, the structured
output route, the pruning decision — as opposed to the model's own behaviour. And the
plumbing (a test server, a logged-in client, a stream parser) is the same plumbing an
end-to-end test suite needs, which the project has never had; every route has been
verified by hand with `curl`.

All of it is buildable and testable without a credential, up to the final call.
