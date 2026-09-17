# Experiment 035 — Which Layer Owns the Latency

## Objective

`observe.ts`'s own docstring has carried this gap since Experiment 014:

> "IMPORTANT — what `ms` means for a streaming route. The timer stops when the
> handler RETURNS, and `/api/chat` returns as soon as the stream is opened, before
> the model has produced a single token... Measuring the latter means
> instrumenting inside the stream. Deferred, and recorded so the figure is not
> misread."

README's Deferred list has the same gap as one line: "Tracing — which layer owns
the latency, not just the total." Close the smallest real piece of it: retrieval is
the one phase of a `/api/ask` turn that runs entirely without the Anthropic
credential, so it's the one phase this project can actually measure today, not just
design for.

## What happened

Confirmed the docstring's claim first rather than trusting it: `observe()` times
from when the route handler is called to when it RETURNS a `Response`. For
`/api/ask`, that return happens the moment the `ReadableStream` is constructed —
before `answerFromNotebook()` has done anything. So the route-level `ms` recorded
for `ask` in `/metrics` was never "how long did this take", it was "how long did it
take to start the stream" — close to zero, always, regardless of how long retrieval
or generation actually took. Measured live: `ask` reported p50 7ms / p95 95ms across
three real calls that each did a full retrieval internally. The number was correct
and almost meaningless.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/knowledge.ts` | `retrieve()` now times itself and calls `telemetry.record({ route: "retrieval", status, ms })` on both success and failure — no new subsystem, reusing the exact per-label p50/p95 grouping `/metrics` already renders for real HTTP routes. |

No new file, no new test file — see Not Verified below for why.

## Important concepts

**`telemetry.record()`'s `route` field is a label, not necessarily an HTTP route.**
`Entry`/`Buffer`/`snapshot()` in `telemetry.ts` never assumed the string was a URL
path — it groups by whatever string it's given. Recognizing that meant this needed
zero new infrastructure: reusing an existing grouping mechanism for an internal
phase, rather than building a second one because the first one's name suggested it
was only for routes.

**A number can be precisely correct and still answer the wrong question.**
`observe()`'s route-level timer isn't buggy — it measures exactly what it claims to
(time to first byte of the response). The gap was that nothing else measured what
people actually want to know for a streaming route: how long the real work inside
the stream took. Both numbers are now visible, and they're allowed to disagree —
that disagreement (7ms route timer vs up to 680ms of retrieval alone) is itself the
finding `observe.ts`'s docstring predicted.

## Decisions

**Labelled `"retrieval"`, not `"ask"` or `"agent"`.** `retrieve()` is called from
both `/api/ask` and (via `search_notebook`) `/api/agent`'s tool loop. One label
across both callers means `/metrics` shows the TRUE cost of retrieval regardless of
which route triggered it, instead of splitting one phenomenon into two
route-shaped buckets that would each undercount it.

**Recorded on failure too, with `status: 500`.** A retrieval that throws (a
corrupted cache, a bad embedding) still cost time before it failed — silently
excluding failed attempts from the latency picture would make retrieval look
faster than it is exactly when something is going wrong with it.

## Not verified

- **No unit test added.** `knowledge.ts` has never had one — it does real file I/O
  and real embedding calls, and every other function in the module is exercised via
  `pnpm e2e`/`pnpm eval` instead, not `pnpm test`. Adding a first unit test here
  would mean mocking `getIndex()`/`embed()`/`topK()` to test one `record()` call,
  which tests the mock's wiring more than this function. Verified live instead: a
  running dev server, three real `/api/ask` calls, confirmed a `retrieval` row
  appeared in `GET /api/metrics` with real, non-fabricated numbers.
- **Generation latency — the other half of "which layer owns it".** Still entirely
  unmeasured, and still genuinely blocked: it only exists once a model call
  succeeds, which needs the credential this project doesn't have.

## Status

| Piece | State |
| --- | --- |
| `retrieve()` records its own latency, success and failure | ✅ Verified live (3 real `/api/ask` calls → a `retrieval` row in `/api/metrics`, p50 15ms / p95 680ms) |
| Confirmed the docstring's claim about what route-level `ms` measures | ✅ Verified (`ask`: p50 7ms / p95 95ms — time-to-first-byte, not real work) |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass |

## Next Step

Generation-phase latency stays blocked on the credential — nothing new to build
against it. The instrumentation/route `indexBuilt` cross-layer question (033, 034)
is also still open, now cosmetic only. No queued item beyond those two known gaps.
