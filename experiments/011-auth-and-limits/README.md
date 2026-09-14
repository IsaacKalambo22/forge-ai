# Experiment 011 — Auth, Rate Limiting and Cost Control

## Objective

Close the oldest open item in the project: five endpoints, one of which can make six paid
API calls per request, with no authentication, no rate limit and no spending ceiling.

## Questions

1. Who may call these endpoints?
2. How often?
3. What bounds the bill when the answer to (1) is "anyone"?
4. Can a shared secret authenticate a browser?

## Why it was deferred five times

Experiments 003, 007, 008, 009 and 010 each ended by recording this as deferred. That was
the right call each time — there was nothing to protect yet — but the project has since
acquired an endpoint (`/api/agent`) that loops up to six paid requests per call, and the
reason to defer expired somewhere around Experiment 009.

Three separate problems hide under one heading, and they need different mechanisms:

| problem | mechanism |
| --- | --- |
| who may call | authentication |
| how often one caller may call | per-caller rate limit |
| how much money can be spent in total | global budget |

A rate limit alone does not bound the bill: 100 callers at a permitted rate spend 100×.

## Implementation

```text
src/lib/ratelimit.ts   token bucket — pure, injected clock, no imports
src/lib/guard.ts       "server-only": auth + per-caller limit + global budget
```

`guard(request, route)` returns a `Response` to send instead of doing the work, or `null`
to proceed. It is the **first statement in every route**, before the body is even parsed —
both because an unauthenticated caller should not reach the parser, and because
Experiment 004 established that a streaming route loses the ability to set a status code
after the first byte. A 429 emitted mid-stream would be an HTTP 200.

### A token bucket, not a fixed window

A fixed window lets a caller spend the entire allowance at 11:59:59 and the entire next
allowance at 12:00:00 — double the intended rate, at the worst possible moment. A bucket
refills continuously, so there is no boundary to exploit.

The clock is a parameter rather than a call to `Date.now()` inside the function. That is
what makes 21 tests run instantly instead of a suite that sleeps through real minutes and
still misses the edges.

### Cost is weighted, because the routes are not equal

| route | cost | why |
| --- | --- | --- |
| `search` | 0 | local embedding model — spends no money |
| `chat`, `analyze`, `ask` | 1 | one upstream request |
| `agent` | **6** | `MAX_STEPS` — one call can be six paid requests |

Free routes still cost 1 against the per-caller limit, so "spends no money" does not mean
"may be hammered" — the embedding model is CPU, and CPU is a resource too.

### Verified: 21/21 on the limiter

```text
Basic:    starts full · spend 1 of 10 · spend remaining · denied at 0 · retry-after 1s
Refill:   4s→4 tokens (5 denied, 4 allowed) · 10s→full · 1h→capped at capacity, not 3600
Weighted: agent costs 6 → 4 left · second agent call denied · retry-after scales to 2s
Edges:    zero cost free · cost above capacity never satisfiable
          backwards clock cannot mint tokens · input bucket not mutated
Eviction: idle+full evicted · idle+refilled-to-full evicted · recent kept
          count returned · bucket still in debt never evicted

21 passed, 0 failed
```

Two of those are defences rather than behaviour:

- **A backwards clock cannot mint tokens.** Elapsed time is clamped at zero. Without that,
  an NTP correction hands out free capacity.
- **Idle buckets are evicted.** The caller map is keyed by an attacker-supplied value, so
  without eviction it is an unbounded allocation — a rate limiter that can be made to
  exhaust memory has defeated its own purpose. Eviction only removes buckets that are
  *both* idle and refilled to capacity, so nobody escapes a limit by waiting.

### Verified: measured against the running server

**Burst** — 24 requests to `/api/search` from one address, capacity 20:

```text
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429 429 429
```

Exactly 20 through, then 429 with usable headers:

```text
HTTP/1.1 429 Too Many Requests
retry-after: 2
ratelimit-limit: 20
ratelimit-remaining: 0
{"error":"Rate limit exceeded","retry_after_seconds":2}
```

**Isolation** — a second address was unaffected while the first was exhausted.

**Weighting** — `/api/agent` at cost 6 from a fresh address: `200 200 200 429 429`. Three
calls (18 tokens), then denied. A chat caller gets 20 calls from the same bucket; an agent
caller gets 3, because an agent call is worth six of them.

**Refill** — drained, then measured against a wall clock:

| elapsed since drain | requests allowed |
| --- | --- |
| 0 s | 0 |
| 3 s | 1 |
| 3.1 s (after re-draining) | 1 |
| 6.2 s (after re-draining) | 2 |

One token per three seconds, exactly as configured.

### Verified: authentication

With `APP_SECRET` set:

| request | result |
| --- | --- |
| no `Authorization` header | 401 |
| wrong secret | 401 |
| **right length, wrong bytes** | 401 |
| short wrong secret | 401 |
| raw secret without `Bearer ` | 401 |
| correct `Bearer <secret>` | 200 |

Every failure returns the identical `{"error":"Unauthorized"}`. The difference between
"missing" and "wrong" is information, and an attacker can use it.

Comparison uses `timingSafeEqual`, so the secret cannot be recovered a byte at a time by
measuring response times. A length mismatch is handled explicitly, because
`timingSafeEqual` throws on unequal lengths and the throw would itself leak the length.

**Auth runs before parsing.** Malformed JSON with no credentials returns **401, not 400** —
an unauthenticated caller never reaches the parser.

### Verified: production fails closed

An unset secret in development means "local machine, carry on". An unset secret in
production means someone deployed a paid endpoint to the internet without configuring it —
which must not be read as permission.

Built and run under `next start`, `APP_SECRET` unset:

```text
/api/chat     {"error":"Server is not configured for public access"}  503
/api/analyze  503
/api/search   503
/api/ask      503
/api/agent    503
```

With `APP_SECRET` set: no auth → 401, wrong secret → 401, right secret → 200.

This is the one claim that could not be checked with `next dev`, since it forces
`NODE_ENV=development`. It needed a real production build to verify, so it got one.

### Finding: a shared secret cannot authenticate a browser

`APP_SECRET` protects programmatic access. It cannot protect the UI, and the reason is
Experiment 001's lesson arriving from a new direction: **for the browser to send the
secret, the browser must hold it — and anything the browser holds, the user can read.**

Passing `APP_SECRET` to the client would recreate exactly the mistake Experiment 002
found, with a different secret. So it is not done.

What the browser actually needs is a **session**: the user proves who they are once, the
server issues a cookie it can verify, and the cookie is useless to anyone else. That is a
different mechanism, not a variation on this one. It is deferred — but now with a reason
rather than a shrug.

Practical consequence: with `APP_SECRET` set, the UI stops working. That is honest — the
UI currently has no way to authenticate, and pretending otherwise would mean shipping the
secret to the browser.

### Verified: nothing regressed

| Check | Result |
| --- | --- |
| dev with no `APP_SECRET` — `/api/search`, `/api/ask`, `/api/agent` | 200, open as before |
| all five routes reach validation when authorised | 400 on empty body |
| `APP_SECRET`, the secret value, `timingSafeEqual`, `refillPerSecond` in browser | **0 hits each** |
| bundle | 3,774,319 bytes — **byte-identical to Experiments 009 and 010** |
| `next build` | clean, 5 dynamic routes |

## Lessons

1. "No auth and no rate limit" is three problems: **who**, **how often**, and **how much in
   total**. A rate limit does not bound a bill — 100 callers at the permitted rate spend
   100×.
2. **Token bucket over fixed window.** A fixed window permits double the intended rate
   across its boundary.
3. Inject the clock. A rate limiter tested by sleeping is slow and still misses the edges;
   with an injected clock, 21 cases run instantly.
4. **Weight the cost by what the route actually spends.** One agent call is six paid
   requests; treating it as one request is a 6× hole.
5. Charge free routes something. CPU is a resource even when money is not.
6. Clamp elapsed time at zero, or a backwards clock mints capacity.
7. **A rate-limit map keyed by caller address is an unbounded allocation.** Evict idle
   buckets — but only ones that are already refilled, so waiting is not an escape.
8. The guard goes before body parsing: an unauthenticated caller should not reach the
   parser, and a streaming route cannot set a status code later (Experiment 004).
9. Return the same error for missing and wrong credentials. The distinction is
   information.
10. Compare secrets in constant time, and handle the length mismatch explicitly — the
    throw leaks length on its own.
11. **Fail closed in production, open in development.** An unset secret means different
    things in the two places, and only one of them is permission.
12. Verify the production path with a production build. `next dev` forces
    `NODE_ENV=development`, so the fail-closed branch is unreachable there.
13. **A shared secret cannot authenticate a browser** — the browser would have to hold it.
    Sessions are a different mechanism, not a variant of this one.

## Future questions

- **Session authentication** for the UI, so `APP_SECRET` stops being all-or-nothing.
  Now the most substantial open item.
- **State is in memory.** It resets on restart and is not shared between instances, so
  this bounds accidents and casual abuse, not a determined attacker against a scaled
  deployment. Redis is the answer. *Deferred.*
- **`x-forwarded-for` is client-supplied** unless a trusted proxy overwrites it. Behind
  Vercel it is trustworthy; exposed directly, the limiter is per-attacker-whim. Documented
  in the code at the point where it matters.
- The daily budget counts **requests**, not tokens or dollars. Once `usage` is observable
  it should count what is actually billed. *(Depends on an API key.)*
- Nothing logs who called what. A limit you cannot observe being hit is hard to tune.
  *Deferred to an observability experiment.*
