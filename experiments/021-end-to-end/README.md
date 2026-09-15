# Experiment 021 — Gathering the `app` Claims

## Objective

Experiment 020 built `pnpm verify` and it covered **5 of 9** claims. The other four —
structured output, the tool loop, the agent loop, and whether pruning breaks citations
— need the running application, not a direct API call.

Those four are also the interesting ones: they exercise the code **this project
wrote**, as opposed to the model's behaviour.

And the plumbing they need — a test server, a logged-in client, a stream parser — is
what an end-to-end suite needs. The project had **553 unit assertions and zero
end-to-end coverage**: every route had only ever been checked by hand with `curl`.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/ndjson.ts` | The NDJSON reader, extracted. One implementation, finally. |
| `scripts/app-client.mts` | Starts a throwaway server; registers, logs in, drives routes |
| `scripts/e2e.mts` | `pnpm e2e` — the project's first end-to-end suite |
| `scripts/verify-live.mts` | Now gathers all 9 claims, fault-tolerantly |
| `tests/ndjson.test.mts` | 21 assertions, replacing `stream.test.mts` |

Unit suite: **553 → 561.** New: **32 end-to-end assertions.** No new dependencies.

## Key Concepts

**A test that mirrors the implementation tests nothing.** `tests/stream.test.mts`
opened with *"The algorithm lives in chat.tsx and ask.tsx; this mirrors it"* — so
there were **three** copies of a boundary-sensitive reader and a test covering none of
them. It could pass while both clients had the exact bug it was written to catch.
Experiment 021 needing a fourth copy is what finally justified extracting it.

**End-to-end coverage answers a different question from unit coverage.** 553
assertions proved the pieces were right. Nothing proved they fit together — that a
session cookie issued by `/api/login` is accepted by `/api/chat`, that a 404 for
someone else's conversation is byte-identical to one for a fake id *over real HTTP*.

**Fault-tolerant gathering.** A verification harness that aborts the whole run because
one probe failed reports nothing about the other eight. Probes fail independently in
practice — a decline, a rate limit, a route that is down — so each section is wrapped
and a failure leaves its claims *not gathered* rather than *failed*.

## Observations

### Observed — `pnpm e2e`, 32 assertions, no credential required

```text
e2e — the server is up and closed to anonymous callers
  ✓ an unauthenticated paid route is refused
  ✓ so is the free one — free is not public
e2e — a registered user can sign in and work
  ✓ search succeeds                      3 results
  ✓ the top hit is the capped-loop lesson   006-cap-the-loop
e2e — validation, over real HTTP
  ✓ empty / missing / non-string message · unknown persona
  ✓ unknown conversation is 404 · a GET to a POST-only route is 405
e2e — every response carries a correlation id (Experiment 014)
  ✓ X-Request-Id is present              rmlrrchy
e2e — a conversation is created and persisted (Experiment 015)
  ✓ a conversation id arrives before any model output
  ✓ the model call fails, and says so in-stream, on a 200
e2e — AUTHORIZATION across two real users (Experiment 016)
  ✓ bob gets 404 for alice's real conversation
  ✓ the two responses are byte-identical
e2e — logout revokes the session (Experiment 015)
  ✓ the same cookie is now refused
e2e — the server logged structured JSON throughout (Experiment 014)
  ✓ no secret ever reached the log
  ✓ nor any password

  32 passed, 0 failed
```

Seven experiments' claims, re-verified through the front door rather than through
their own modules. The redaction claim from 014 is the one worth noting: the unit
tests prove `redact()` works, and this proves **nothing tried to log a secret in the
first place** — a different and stronger statement.

### Observed — the shared reader survives every chunk boundary

```text
✓ all 218 chunk sizes produce 4 events and identical text
✓ no replacement characters at any chunk size
✓ a malformed line does not kill the stream
```

The last one is a latent bug fixed by the extraction: both clients called
`JSON.parse(line)` unguarded, so **one malformed line would throw out of the read loop
and silently truncate an otherwise fine response.** Now it is skipped and counted.

### Observed — the app-gathering path works, with correct verdicts

Run with a deliberately invalid key, so the SDK probes fail and the app section still
runs:

```text
  ! could not gather basic call: 401 … "API key is invalid."
  ! could not gather truncation probe: 401 …
  starting a server for the app-backed claims…

  ✗ 005-schema-conformance    parsed_output was null — the output did not validate
  ✗ 006-tool-loop-executes    the model never requested a tool
  ✗ 009-agent-loop-executes   no step events — the loop never ran
  ? 019-pruning-preserves-citations   the answer was empty

  0 passed, 4 failed, 5 not gathered
```

Every verdict is **true**: with an invalid key the model really never requested a tool
and the loop really never ran. The harness is not simulating anything.

### Observed — the three-verdict design earning itself

`019` returned **`unusable`, not `fail`**. An empty answer is not evidence that pruning
broke citations; it is evidence the fetch produced nothing to judge. Had `unusable`
been collapsed into `fail`, this run would have reported a regression in Experiment
019's pruning decision that does not exist.

That distinction was a design guess in 020. This is the first time it did real work.

## Mistakes / Failures

**The end-to-end suite leaked a server process on every run, and reported success
while doing it.**

*What happened.* `pnpm e2e` passed 32/32 and exited. Later, `pnpm verify` could not
start its own server: `Server did not start within 60s`.

*What I assumed.* A port conflict, or a bug in the new gathering code — I went looking
in the wrong file first.

*What was actually wrong.*

```text
$ pgrep -fl next
25446  next dev --port 3311
25517  next-server (v16.3.4) FORGE_DB_PATH=/var/folders/…/forge-e2e-dhXg18/e2e.db
```

Both left over from the *successful* e2e run. `next dev` spawns a separate
`next-server` process; `child.kill()` killed the parent and orphaned the grandchild,
which kept holding the port. Next then detected the orphan and politely declined to
start another:

```text
You can access the existing server at http://localhost:3311,
or run kill 25517 to stop it and start a new one.
```

So the failure surfaced in a *different command*, minutes later, pointing at code that
was not at fault.

*The fix.* `detached: true` puts the child in its own process group, and `stop()` kills
the **group** (`process.kill(-pid)`) instead of the process.

*Verified.* Two consecutive `pnpm e2e` runs, both 32/32, `pgrep` clean after each —
the second of which would previously have failed.

*What it taught me.* Two things worth keeping. **A harness has to clean up after
itself or it poisons the machine for everything that follows** — and it will do so
while reporting success, because the leak is invisible to the thing that caused it.
And `kill(pid)` is not "stop this program": a process that spawns children needs the
group killed, and the symptom shows up somewhere else entirely.

## Decisions

**Extract the NDJSON reader now, not earlier.** Three copies were tolerable under the
project's no-premature-abstraction rule; the fourth, plus a test that admitted to
mirroring rather than testing, was not. The justification is written into the module
header in the required form.

**A throwaway database per run.** `FORGE_DB_PATH` into a temp directory. An end-to-end
suite that writes into `.data/forge.db` is one nobody runs twice.

**Budgets raised to $1000 for the test server.** Otherwise a long run could trip
Experiment 017's ceiling and produce a 429 that looks like a routing failure. A test
that can fail for a reason unrelated to its subject is worse than no test — the same
rule that made 020's cache probe pad its prefix.

**`pnpm e2e` is separate from `pnpm test`.** Same reasoning as `pnpm eval` in 013: it
starts a server and takes ~30 seconds, and a slow suite folded into a fast one gets
skipped.

**`stream.test.mts` deleted rather than kept.** It tested a copy. Keeping it would
mean maintaining the mirror it was the problem.

## Questions

- **`pnpm e2e` is not in CI**, because there is no CI. It is a command someone has to
  remember — better than nothing, and not a gate. The most valuable missing piece in
  the project right now.
- **The e2e suite cannot assert anything about model output**, so the routes are
  verified up to the point where the credential is needed and no further.
- **Nothing tests the client components.** `chat.tsx` and `ask.tsx` now share the
  tested reader, but their state handling — what happens to `streaming` when an error
  event arrives mid-stream — has never been exercised by anything but hand-clicking.
- **Server startup is polled with a 60s deadline and a fixed port.** Two harnesses
  running at once would collide. Fine for one developer; it is a real limitation of
  the design.
- **`app-client.mts` has no tests of its own.** It is tested transitively by the 32
  e2e assertions that depend on it working.
- **The successful branch of every claim is still unobserved.** Unchanged by this
  experiment, and the reason it exists.

## Status

| Piece | State |
| --- | --- |
| `ndjson.ts` extracted; 3 copies → 1 | ✅ Verified, 21 assertions over 218 chunk sizes |
| Malformed-line crash fixed | ✅ Verified |
| `pnpm e2e` — first end-to-end suite | ✅ **32 assertions, no credential needed** |
| Process-group leak | ✅ **Found and fixed; re-runnable** |
| `pnpm verify` coverage 5/9 → 9/9 | ✅ Verified — gathering exercised with an invalid key |
| Fault-tolerant gathering | ✅ Verified — 4 probes failed independently |
| Any claim passing on real evidence | ⛔ Blocked — no API credential |
| CI | ⬜ Open — nothing runs any of this automatically |

## Next Step

**Experiment 022 — Continuous Verification.**

The project now has four commands that check different things — `pnpm test`,
`pnpm e2e`, `pnpm eval`, `pnpm verify` — and **nothing runs any of them.** Every one
depends on a person remembering, which is the same failure mode as the comment that
claimed a rate limit that did not exist (Experiment 012) and the README that
contradicted itself for twelve experiments (013).

A verified claim can silently regress, and this experiment added the clearest example:
a leak that reported success. The gap is no longer "what should we check" — it is
"what makes the checking happen".

That means a CI workflow, and a decision about what belongs in it: the unit suite on
every commit, the e2e suite too (it needs no credential), the retrieval benchmark as a
regression alarm, and `pnpm verify` only where a credential exists.
