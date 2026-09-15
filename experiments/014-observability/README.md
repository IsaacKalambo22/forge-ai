# Experiment 014 — Observability

## Objective

Experiment 013 asked *is it good?* against a fixed, labelled set, offline. This asks
the paired question: **what is it actually doing on a request nobody labelled?**

And it pays a debt. Since Experiment 001 the README has carried this:

> Forwarding the provider's text is a deliberate development-time trade-off. It is how
> the 401 gets diagnosed from `curl`, but in production it leaks which provider is in
> use. Logging it server-side and returning a correlation id instead is *deferred —
> revisit later*.

That deferral was waiting on somewhere to put the real error. Logging is that
somewhere, so the two arrive together.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/stats.ts` | `percentile`, `summarize`. Pure, no imports. |
| `src/lib/log.ts` | Structured JSON lines, **redaction**, correlation ids. Pure. |
| `src/lib/telemetry.ts` | Bounded ring buffer + per-route snapshot. Pure core. |
| `src/lib/observe.ts` | `observe()`, `failure()`, `streamFailure()`. `server-only`. |
| `src/app/api/metrics/route.ts` | `GET /api/metrics` — the aggregate view. |

All six route handlers rewired. Test suite: **199 → 264 assertions.**

## Architecture

```text
POST /api/analyze
   │
   ▼
observe("analyze", handler)         ← id, timer, log line, telemetry, header
   │
   ├─ handler(requestId)
   │     ├─ guard()                  auth · rate limit · budget
   │     ├─ validate                 400s, cheap and early
   │     └─ analyzeConversation()    the paid call
   │           └─ throws  ──→  failure(requestId, …)
   │                             ├─→ log  · FULL cause, redacted
   │                             └─→ client · id only
   │
   └─→ Response + X-Request-Id
         │
         └─→ telemetry.record() ──→ GET /api/metrics
```

Two readers, two different questions. **Logs** answer *what happened to this one
request* — the user hands over an id and the line is found. **Metrics** answer *what
is happening in aggregate* — no id, no single request, just the distribution.

## Key Concepts

**Structured logging.** One JSON object per line instead of a prose sentence.
`console.log("chat took", ms, "ms")` is readable by a human watching one terminal and
useless to everything else — it cannot be filtered, counted, or have a percentile
taken of it. A JSON line can be queried by a machine and still read by a person.

**Correlation id.** A short random id generated per request, returned to the client
and stamped on every log line for that request. It is what lets the server **stop
explaining its failures to the client**: the user reports an opaque `hms069k2`, the
operator greps for it, the real cause is there.

**Redaction.** Logs get shipped, retained, and read by people who are not you. A log
that captures a secret has copied that secret somewhere with *weaker* access control
than where it came from. Two independent mechanisms, because neither alone suffices:

```text
by KEY NAME    authorization, cookie, x-api-key, password, token …
by VALUE SHAPE sk-ant-…, Bearer …  — catches a key pasted into free text
```

Key-name matching misses a key inside a provider's error *message*, which is exactly
the shape this project's failures take. Value-shape matching misses a session cookie
of arbitrary bytes. Both, or neither works.

**Percentile, not average.** The average hides the tail, and the tail is the user
experience. Nine 100ms requests and one 10-second request average to 1090ms — a number
describing no request that actually occurred, implying everything is mildly slow when
in fact one user in ten waited ten seconds. p50 shows the typical; p95 finds the
outlier.

**4xx is not an error rate.** A 400 means the *client* sent something invalid and the
server behaved correctly. Counting it makes your health alarm ring when someone else's
script is broken. Only 5xx counts here.

**Bounded buffer.** An unbounded array of every request is a memory leak with a slow
fuse: fine in development, exhausts the process in production. That would be a
self-inflicted outage caused by the code meant to detect outages.

## Implementation

**`observe()` is an abstraction, so it is justified in its own doc comment** — per the
project rule. Five handlers each needed an id, a timer, a log line, a telemetry record
and a response header, identically. Inline that is ~15 lines of bookkeeping × 5, and
the one route where somebody forgets is invisible *precisely because observability is
what is missing from it*. It is one function wrapping one handler — no middleware
stack, no plugin registry, no context object.

**`telemetry.ts` follows the `ratelimit.ts` shape**: pure functions over an explicit
value, with the mutable instance in a clearly-marked section at the bottom. That split
is what made the rate limiter testable in Experiment 012.

**The streaming routes needed a second fix.** `/api/chat`, `/api/ask` and `/api/agent`
cannot return a Response once they have sent a byte (Experiment 004), so their errors
ride *inside* the body — and they were leaking the provider's text there too, just
somewhere less obvious than a JSON error field. `streamFailure()` is `failure()` for
that case.

**The development exception is narrow and deliberate.** Outside production the detail
is *also* returned, because the curl-driven debugging loop this project is built
around depends on it. `NODE_ENV` is set by the framework, not by the request, so a
caller cannot flip it.

## Testing

```bash
pnpm test    # 264 assertions
pnpm build && APP_SECRET=… pnpm start    # production behaviour is different, so it was run
curl -D- …   # headers matter here, so -D- throughout
```

## Observations

### Observed — the correlation id connects the two halves

Development, bad key:

```text
client ← {"error":"Analysis failed","request_id":"u7z7lyci", "detail_dev_only":"401 …"}
log    → {"level":"error","msg":"Analysis failed","request_id":"u7z7lyci",
          "route":"analyze","status":502,"error":"401 {…invalid x-api-key…}"}
log    → {"level":"error","msg":"request","request_id":"u7z7lyci",
          "route":"analyze","status":502,"ms":2905}
```

One id, three places. That is the entire mechanism.

### Observed — the Experiment 001 debt is closed, verified in a production build

Not inferred from the code. Built with `pnpm build` and served with `pnpm start`:

```text
$ curl -D- -X POST localhost:3100/api/analyze -H 'Authorization: Bearer …' …
HTTP/1.1 502 Bad Gateway
x-request-id: hms069k2
{"error":"Analysis failed","request_id":"hms069k2"}
```

No `401`, no `x-api-key`, no vendor name. The server log holds the full cause under
`hms069k2`. Before this experiment the same request returned:

```text
{"error":"Analysis failed: 401 {\"type\":\"error\",\"error\":{\"type\":
 \"authentication_error\",\"message\":\"invalid x-api-key\"}}"}
```

### Observed — the p95 found something the average was hiding

Ten real `/api/search` requests, in order:

```text
   1. status 400     16 ms
   2. status 200   1579 ms   ← the embedding model loading
   3. status 200      9 ms
   4. status 200     16 ms
   5. status 200     25 ms
   6. status 200      6 ms
   7. status 200      6 ms
   8. status 400      0 ms
   9. status 400      1 ms
  10. status 400      1 ms

  mean = 166 ms
  p50  =   6 ms
  p95  = 1579 ms
```

**The mean, 166ms, describes no request in this set.** Not one took anywhere near it.
p50 describes the steady state; p95 isolates the cold start where `search.ts` builds
its cached index. This is the argument for percentiles, observed rather than asserted,
and it appeared in the first ten requests ever measured.

It also independently confirms that the Experiment 007 index cache works: 1579ms once,
then 6–25ms forever.

### Observed — the 4xx decision paid off immediately

```json
"search": { "count": 10, "byStatus": {"200": 6, "400": 4}, "errorRate": 0 }
```

Four of ten requests were rejections, and the error rate is correctly 0 — the server
did its job every time. Had 4xx counted, this would read as a 40% failure rate caused
entirely by me sending deliberately empty queries.

### Observed — fail-early is now ~180×, not the ~50× recorded in Experiment 001

```text
local validation rejection      0–16 ms
provider auth rejection      1017–2905 ms
```

The gap is the network round trip, as 001 concluded. The *ratio* is much larger than
the 50× measured then — unsurprising, since these are different routes on a different
machine on a different day, but worth recording rather than quietly restating the old
figure.

### Not verified

- **The bearer secret does not appear in the production log (0 matches) — but this is
  weak evidence for redaction.** Nothing in the code attempts to log headers, so
  nothing was there to redact. The evidence that redaction *works* is the 20 unit
  assertions in `log.test.mts`, not this grep.
- **`ms` for the three streaming routes is time-to-response-start, not total
  duration.** The timer stops when the handler returns, and a streaming handler
  returns as soon as the stream is opened — before the model has produced a token.
  It answers "did we accept the request promptly"; it does **not** answer "how long
  did the user wait". Documented in `observe()` so the figure is not misread.
- **Nothing here has been observed under a successful model call**, because there is
  still no API credential. Token counts per request are not recorded yet for that
  reason — there has never been a `usage` object to record.

## Mistakes / Failures

**A latent bug in the correlation id, caught by writing the test before trusting the
code.** The first version was:

```ts
return Math.random().toString(36).slice(2, 10);
```

`Math.random()` does not always produce a long base-36 string. Rarely, `slice(2, 10)`
returns fewer than 8 characters — and for `Math.random() === 0`, an empty string.

*Why it matters more than it looks.* An empty correlation id fails **silently**. No
error, no crash: the user's error page and the log line simply stop matching, and the
one time you need the mechanism is the one time it is not there. A bug in the thing
you debug with is worse than a bug in the thing you are debugging.

*How it was caught.* The test asserted `id.length <= 8` and passed. Writing the
assertion made me ask what the lower bound was, and there wasn't one.

*The fix.* Pad before slicing, and tighten the test to `=== 8`:

```ts
return (Math.random().toString(36).slice(2) + "00000000").slice(0, 8);
```

*What it taught me.* The probability was negligible and the cost of preventing it was
one line. "Unlikely" is a reason to not panic, not a reason to not fix.

**Also fixed, unrelated:** `pnpm lint` had a pre-existing `prefer-const` error in
`ratelimit.test.mts` and was red before this session. A red lint hides the next real
error, so it is fixed.

## Decisions

**Correlation id is not a UUID.** It is read aloud, pasted into chat and
screenshotted. 8 base-36 characters is short enough to transcribe and has ~2.8×10¹²
possibilities — plenty to be unique within one log file, which is all it must be. It
is not a secret, so `Math.random` is adequate.

**`/api/metrics` is behind `guard`, at COST 0.** A latency distribution and per-status
breakdown describe how the service behaves under load — useful to an operator, useful
to someone probing it. Free is not the same as public.

**Telemetry is in-process, and that is a known limitation, not an oversight.** Same as
the rate limiter's: it resets on restart and is not shared between instances. Real
observability ships lines to a collector and aggregates *there*. Deferred until there
is more than one process — the in-process version is what makes the concept visible.

**Redaction is defence in depth, not the primary control.** The primary control is
still not logging secrets. Redaction catches the case where one arrives inside
something else, which is the case that actually happens here.

## Questions

- **Logs go to stdout and nowhere else.** No rotation, no retention, no shipping, no
  search beyond `grep`. That is correct for one process on a laptop and insufficient
  the moment there are two. *Deferred.*
- **No token counts or cost per request.** The most valuable thing to log in an LLM
  application, and impossible to log until there is a successful model call. *Blocked
  on the credential.*
- **No tracing.** One request touching guard → retrieval → provider is currently one
  log line. Spans would show which layer the 2905ms belonged to. *Deferred; the `ms`
  split between retrieval and provider would be the useful first step.*
- **`/api/metrics` returns JSON and nothing renders it.** Deliberate — a dashboard is
  a UI problem, and the numbers are the experiment.
- **No alerting.** Metrics nobody looks at are metrics nobody has. *Deferred.*
- **Streaming duration is unmeasured** (see Not verified). Instrumenting inside the
  stream is the obvious next increment.

## Status

| Piece | State |
| --- | --- |
| `stats.ts`, `log.ts`, `telemetry.ts` + 65 assertions | ✅ Verified |
| Correlation id through log + response + header | ✅ **Verified end-to-end** |
| Provider-leak debt from Experiment 001 | ✅ **Closed, verified in a production build** |
| `GET /api/metrics` | ✅ Verified — real percentiles from real traffic |
| Redaction | ✅ Unit-verified — never exercised in a live leak |
| Streaming total duration | ⬜ Deferred — documented as not-what-`ms`-means |
| Token counts / cost per request | ⛔ Blocked — no API credential |

## Next Step

**Experiment 015 — Persistence.** It is now the largest hole, and three earlier
experiments point at it:

- 003 recorded that client-held history can be **forged** — the server has no record
  of what the model actually said. Fixing it needs server-side transcripts.
- 011 and 014 both record in-process state that dies on restart (rate limiter,
  telemetry) and cannot be shared between instances.
- 012 recorded that sessions **cannot be revoked** before expiry, for want of a
  server-side session list.

All three are the same missing thing. Most of it is testable without an API
credential.
