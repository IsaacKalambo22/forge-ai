# ForgeAI

[![check](https://github.com/IsaacKalambo22/forge-ai/actions/workflows/check.yml/badge.svg)](https://github.com/IsaacKalambo22/forge-ai/actions/workflows/check.yml)

A learning project for AI engineering. The goal is not to ship a product — it is to
understand each layer of an LLM application by building it, one deliberate experiment
at a time.

> **Engineering principle:** understand each layer before introducing abstraction.

## Status

**Experiments 001–042 complete, 043 not yet committed.**
`pnpm check` → all gates pass locally: types · lint · 854 unit · 39 end-to-end ·
retrieval benchmark · 12 headless-browser assertions (skipped automatically if
`chromium` is not installed).

**CI is green, and confirmed by the tool built to check it.** Experiment 026's fix
was confirmed on the push that followed it; Experiment 027 closed the gap that let
three red runs go unnoticed — a badge above, and `pnpm ci-status`, which has now
confirmed itself and Experiment 028 both green on GitHub.

### Completed

- [x] Trust boundary: browser → route handler → AI service
- [x] Request validation, real status codes
- [x] Interactive chat UI, streaming (NDJSON)
- [x] Server-owned system prompts / personas
- [x] Conversation history, client-held, server turn cap
- [x] Structured output with a zod schema
- [x] Tool calling — safe arithmetic parser, capped loop
- [x] Local embeddings (no API key, no network)
- [x] Semantic search + RAG retrieval
- [x] Prompt-injection defence — nonce-fenced passages
- [x] Session auth, rate limiting, daily budget
- [x] Test suite — 646 assertions, no framework
- [x] Evaluation — `pnpm eval`, a scored retrieval benchmark with a baseline
- [x] Observability — structured logs, redaction, correlation ids, `GET /api/metrics`
- [x] Persistence — SQLite transcripts and session revocation, zero new dependencies
- [x] Identity & authorization — real users, scrypt passwords, owned conversations
- [x] Cost accounting — integer-nanodollar ledger, budgets enforced in dollars
- [x] Context management — prefix caching, 53% cheaper at `MAX_TURNS`, lossless
- [x] Agent-loop context — tool-result pruning, 60% cheaper per run
- [x] Verification harness — `pnpm verify`, 9 claims with fixture-tested evaluators
- [x] End-to-end suite — `pnpm e2e`, 32 assertions through the front door
- [x] Continuous verification — `pnpm check`, a pre-push hook, and CI
- [x] Injection tested against the real corpus — which genuinely contains payloads
- [x] Affordable index — cached embeddings; batching ~18× faster
- [x] Warm-up at boot; embedding cache split from application state
- [x] CI root cause found — generated types; plus a cached-failure bug in three loaders
- [x] CI confirmed green on the push following the fix
- [x] Usage recording on `ask` / `agent` / `analyze` — the ledger was blind to three
      of four routes, agent worst of all (one run, several upstream calls)
- [x] Per-user rate limiting — the limiter keyed on IP though identity was already
      known; now keyed on user id wherever `guard()` has one
- [x] CI result visibility — `pnpm ci-status` + a README badge; confirmed green
      against its own push (the commit that added it)
- [x] Professional UI shell — design tokens, shared primitives, a `TopBar` +
      root-layout auth gate shared by every route, and `/metrics` rendering the
      real `GET /api/metrics` data (no fabricated numbers)
- [x] Chat's state machine extracted to `src/lib/chat-state.ts` and tested —
      the first `src/app/` logic tested the same way as `agent.ts`/`ndjson.ts`
- [x] `/api/ask` system prompt split so the request-invariant preamble carries
      a cache breakpoint — request shape verified; real hit still blocked, and
      the preamble may be too small to ever cross the provider's minimum
- [x] Minimum-cacheable-prefix guard — measured `ASK_SYSTEM_PREAMBLE` at ~122
      tokens (documented floor: 1024), confirming it was paying the cache-write
      premium for nothing; both caching call sites now skip marking below it
- [x] `/metrics` spend time-range control (`?window=1h|24h|7d`) — and, while
      verifying it against a live server, found and fixed `/metrics` silently
      reading an always-empty module instance of `currentSnapshot()`/`indexReady()`
      (Next.js bundles the page and the API route into separate module layers)
- [x] Fixed the regression that finding surfaced: `/api/ask`/`/api/agent` 503'd
      on every route layer's first real request despite the boot-time warm-up
      completing — `ensureIndexReady()` waits briefly instead of just checking
      a boolean; verified live, a fresh server's first request now succeeds
- [x] Accessibility pass on the three forms — `login.tsx` gained `required`/
      `autoFocus`/error-to-field association; `chat.tsx`/`ask.tsx`'s selectors
      got real visible labels instead of `aria-label`-only; contrast audited
      against WCAG AA (all text pairs pass)
- [x] Retrieval latency now traced separately from route-level time-to-first-byte
      — reused `telemetry.record()`, no new subsystem; confirmed live that the
      route timer for a streaming route was measuring almost nothing
- [x] `guard.ts` — the app's entire auth/rate-limit/budget boundary — now has
      44 unit assertions; `tests/run.mts` sets `FORGE_DB_PATH=:memory:` before
      test discovery, which is what made its DB-backed singleton calls safe
      to test at all
- [x] Budget reservation — `checkBudget()` used to authorize a request against
      spending so far, so two requests arriving together both read the same
      under-budget figure and both proceeded ("a ceiling with a lip"); it now
      stakes a conservative claim (bounded by `MAX_OUTPUT_TOKENS`, one shared
      constant with `ai.ts`) before returning, and a concurrent second request
      is refused by the first's outstanding claim alone — verified with $0
      recorded spend on either side
- [x] `/metrics`'s budget display now agrees with what `checkBudget()` actually
      enforces — a `reserved` field alongside `spent_today`, and `remaining`
      now subtracts both; verified live against a real in-flight request
      (`reserved` moved from $0 to $0.0256 and back)
- [x] `knowledge.ts`'s `indexReady()` is now genuinely cross-layer — it reads the
      shared embedding cache (hash-presence, not a count, to avoid a false
      positive from orphaned rows) instead of trusting only its own module
      instance's flag; `/metrics` never calls the index builder itself, so this
      was not cosmetic staleness but a badge that could read "Building" forever.
      Verified live: `ready` flipped true from a build that ran entirely in a
      different layer (`instrumentation.ts`'s own warm-up)
- [x] CSRF, audited rather than patched — every cookie this app ever issues comes
      from one function (`sessionCookie()`), unconditionally `SameSite=Strict`
      since Experiment 012 and already regression-tested; the one state-changing
      `PUT` (registration) never reads the cookie at all, and no CORS
      configuration exists anywhere to widen either. No token added — it would
      duplicate a defense that already covers the one path that matters
- [x] `pnpm visual` — the project's first browser-automation dependency
      (`playwright`, devDependency, Chromium only). Drives a real headless
      browser through the lock screen, sign-in, the authenticated shell and
      `/metrics`, asserting real visibility and computed styles rather than
      grepped HTML; wired into `pnpm check` as a 7th gate that skips cleanly
      when chromium isn't installed, the same shape `verify` uses for a
      missing credential
- [x] Three of four UI-usability fixes Isaac reported by using the app: real
      conversation history (`GET /api/conversations`, previously built and
      never exposed) so "cannot navigate" between past conversations is
      closed; mobile inputs fixed from 14px to 16px (the iOS Safari
      zoom-on-focus threshold) and touch targets from ~32-36px to the 44px
      minimum, verified against real computed styles, not assumed from a
      class name; a login screen that says what the product is and what an
      account-less visitor should do. The fourth — visual identity — is
      deliberately not attempted; see [Experiment 042](experiments/042-ui-usability-pass/README.md)
- [x] A manual theme switcher (System / Light / Dark) on top of the dark
      palette `globals.css` has carried since Experiment 030 — that palette
      was already complete, only OS-driven with no override. Reachable signed
      in or out; persists across reloads via a pre-hydration script (no flash
      of the wrong theme); `useSyncExternalStore`, not `useState` +
      `useEffect`, after the project's own lint caught the latter as the
      `react-hooks/set-state-in-effect` anti-pattern — see
      [Experiment 043](experiments/043-theme-switcher/README.md)

### Currently building

Nothing — see Deferred below for the queue.

### Blocked — no Anthropic API credential

Everything downstream of a live model call is built and type-checked but **never
observed**. Since Experiment 020 that list is generated rather than maintained by hand:

```bash
pnpm verify
```

```text
  9 claims blocked. The evaluators for all of them are unit-tested
  against fixtures — run `pnpm test`. Only the evidence is missing.

  Coverage of this harness: 5 of 9 are gathered by a direct API call.
```

**"Blocked" and "unbuilt" are different states.** For each claim, the part that knows
*what would settle the question* is built and tested today; only the evidence is
missing. A key converts the list in one command:

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm verify
```

> A Claude.ai or ChatGPT **subscription is not an API credential.** They are separate
> accounts with separate billing. See [Setup](#setup).

See [Experiment 020](experiments/020-verification-debt/README.md).

### Deferred

- [ ] Caching the system prompt and tool definitions — byte-stable, re-billed every
      turn, but measured (Experiment 032's `estimateTokens`) at ~306 tokens
      combined for the default persona + all three tools: under the 1024
      minimum, so `worthCaching()` would veto it today. Revisit if the tool
      count or persona prompts grow enough to cross the floor
- [ ] Whether the real provider-side minimum matches the documented 1024 tokens
      used by `worthCaching()` — this project has never made a live call with
      `cache_control` set to check
- [ ] Summarisation — deferred until conversations exceed the caching crossover (~25 turns)
- [ ] Wiring `pnpm visual` (Experiment 041) into CI — needs `--with-deps` system
      libraries on the GitHub Actions image and a measurement of the time cost;
      today it runs locally and skips cleanly in CI, which has no chromium
- [ ] Tracing — generation-phase latency specifically; retrieval-phase latency
      is now measured and visible on `/metrics` ([035](experiments/035-retrieval-tracing/README.md)),
      but the model-call phase is still invisible, and still blocked on the credential
- [ ] Log shipping and retention — stdout is enough for one process, not two
- [ ] Moving the rate limiter and telemetry into the store — deliberately deferred
      in 015: hot-path state, and a disk write per request fixes nothing until
      there is a second instance
- [ ] Production deployment hardening

## Setup

### 1. Install dependencies

```bash
pnpm install
```

Requires Node 20+ (developed on v24).

### 2. Add an Anthropic API key

Create a key at [console.anthropic.com](https://console.anthropic.com/settings/keys),
then put it in `.env.local` at the project root:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Notes:

- `.env.local` is git-ignored via `.env*`. Never commit a key.
- The variable is **not** prefixed `NEXT_PUBLIC_`, which is what keeps it out of the
  browser bundle. If you are ever tempted to add that prefix to silence an error,
  don't — see [Architecture](#architecture).
- Environment variables are read when the dev server boots. **Restart after editing
  `.env.local`.**

### 3. Optional: turn on accounts

Locally, with no `APP_SECRET`, the app is open and every conversation is owned by a
built-in `local-dev` user — so `curl` works with no ceremony. Set a secret to turn on
real accounts:

```bash
APP_SECRET=some-long-operator-secret pnpm dev
```

`APP_SECRET` is an **operator** credential, not a user password (that changed in
Experiment 016). It signs session cookies and authorizes registration:

```bash
# create an account — requires the operator secret
curl -s -X PUT localhost:3000/api/login \
  -H 'Authorization: Bearer some-long-operator-secret' \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"a-long-enough-password"}'

# sign in — returns an HttpOnly cookie
curl -s -c cookies.txt -X POST localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"a-long-enough-password"}'
```

Conversations are owned. Another signed-in user asking for one of yours gets
`404 Unknown conversation` — byte-identical to an id that never existed, because a 403
would confirm the id is real. See
[Experiment 016](experiments/016-identity-and-authz/README.md).

In production an unset `APP_SECRET` fails closed with a 503 rather than serving a
metered endpoint to the internet.

### 4. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Optional: headless-browser verification

`pnpm check` (below) includes a `visual` gate that drives a real headless Chromium
through the UI — it skips automatically if the browser isn't installed, so this step
is optional. To enable it:

```bash
npx playwright install chromium
```

On macOS 13, Playwright's installer refuses to even attempt a download ("does not
support chromium on mac13") — it is outside their tested support window, not an
actual incompatibility. Verified: the override below downloads the mac14 build,
which launches and renders correctly on mac13.

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14 npx playwright install chromium
```

See [Experiment 041](experiments/041-headless-browser-verification/README.md).

## Testing the endpoint

The API can be exercised directly with `curl`, without any UI. Do this first — it
separates "is my model call working" from "is my React working," which are two very
different debugging sessions.

**Validation (works without an API key):**

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' -d '{"message":""}'
```

Returns `{"error":"message must be a non-empty string"}` with HTTP 400. The same 400
is returned for a missing field, a whitespace-only string, or a non-string value. A
`GET` returns 405 — Next derives that from the fact that only `POST` is exported.

**Starting a conversation (needs an API key for the reply, but not for the id):**

```bash
curl -s -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in one sentence.","persona":"terse"}'
```

Since Experiment 015 the request carries **one message, not a history**. The first
line of the stream is the conversation id; send it back to continue:

```bash
curl -s -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversation_id":"<id from above>","message":"And again, shorter."}'
```

The server owns the transcript. There is no parameter through which a client can
supply an assistant turn — see [Experiment 015](experiments/015-persistence/README.md).

The stream's `done` event carries the fields worth reading every time:

| Field | What it tells you |
| --- | --- |
| `content` | An **array of blocks**, not a string. Narrow on `block.type === "text"`. |
| `usage` | Input and output token counts — the basis of cost. |
| `stop_reason` | `end_turn` normally; `max_tokens` when the 1024 ceiling truncates it. |
| `model` | Which model actually served the request. |

### Known failure: no API key

With the placeholder key, a model call fails upstream. Since Experiment 014 the client
is told only this:

```text
HTTP/1.1 502 Bad Gateway
x-request-id: hms069k2
{"error":"Analysis failed","request_id":"hms069k2"}
```

502 rather than 500, because the server is fine — the service it depends on is not.

The real cause goes to the server log under that id, redacted:

```text
{"level":"error","msg":"Analysis failed","request_id":"hms069k2","route":"analyze",
 "status":502,"error":"401 {…\"message\":\"invalid x-api-key\"}"}
```

**This closes the debt recorded here since Experiment 001**, where the route forwarded
the provider's raw text to the browser and so announced which vendor was behind it.
Outside production the detail is still returned as `detail_dev_only`, because the
curl-driven debugging loop depends on it; `NODE_ENV` is set by the framework, not by
the request.

## Cost

Spending is capped in **dollars**, read from a durable ledger — not by counting
requests, which Experiment 011 used as a proxy and 017 replaced. Defaults are $5/day
total and $1/day per user, deliberately small:

```bash
FORGE_DAILY_BUDGET_USD=50 FORGE_USER_DAILY_BUDGET_USD=20 pnpm dev
```

`GET /api/metrics` reports it alongside latency:

```json
"budget": { "daily_budget": "$5.0000", "spent_today": "$1.1000",
            "remaining": "$3.9000", "per_user_budget": "$1.0000" }
```

Costs are integer **nanodollars**, never floats — `$X/MTok` is exactly `X × 1000`
nanodollars per token, so every rate is a whole number and nothing rounds. Routes
costing nothing (`/api/search` runs a local model) are exempt, so a spending limit
cannot refuse work that spends no money.

Rates are Anthropic first-party, verified 2026-09-15: `claude-opus-5` at $5.00/MTok
in, $25.00/MTok out — **output is 5× input** — with cache reads at 0.1× and writes at
1.25×. See [Experiment 017](experiments/017-cost-accounting/README.md).

## Context cost

History is resent on every turn and billed every time — Experiment 003 measured the
growth as quadratic. `pnpm cost` projects the alternatives:

```bash
pnpm cost
```

```text
   turns        full      window      cached   cheapest (lossless only)
      20     $0.7000     $0.3387     $0.3271   cached ← MAX_TURNS

    today (full history)  $0.7000  per conversation
    with prefix caching   $0.3271
    saving                $0.3729  (53%), losing nothing
```

Prefix caching is used, not a sliding window: at `MAX_TURNS = 20` it is **cheaper and
lossless**, which contradicted the "cheaper but worse" tradeoff I expected. A window
only wins past turn ~25 — so if the cap is ever raised, re-run `pnpm cost` and revisit.

Note also that **output is 5× input and no context strategy touches it**: at 20 turns
the input side is 71% of the bill. See
[Experiment 018](experiments/018-context-management/README.md).

The agent loop gets the **opposite** treatment — pruning, not caching:

```text
         strategy   input  cacheRead  cacheWrite      cost
             full   13200          0           0   $0.0660
           cached      50       8850        4300   $0.0316
           pruned    5320          0           0   $0.0266
    pruned+cached      50        922        4348   $0.0279
```

Caching is a prefix match and needs an **append-only** history. A conversation appends;
a pruned agent loop *edits* earlier tool results, which invalidates the cache from the
edit point — reuse collapses from 8850 tokens to 922 while the 1.25× write premium is
still paid. **Combining the two optimisations is worse than either alone.** See
[Experiment 019](experiments/019-agent-context/README.md).

## Observability

```bash
curl -s localhost:3000/api/metrics | python3 -m json.tool
```

```json
"search": {
  "count": 10,
  "byStatus": { "200": 6, "400": 4 },
  "errorRate": 0,
  "latency": { "count": 10, "min": 0, "p50": 6, "p95": 1579, "max": 1579 }
}
```

Two things worth reading in that. The **mean of those ten requests is 166ms, a figure
describing none of them** — p50 is the steady state and p95 is the one cold request
that loaded the embedding model. And the **error rate is 0 despite four 400s**,
because a 400 means the client sent something invalid and the server behaved
correctly; counting it would make the alarm ring for someone else's broken script.

See [Experiment 014](experiments/014-observability/README.md).

## Checking everything

```bash
pnpm check
```

```text
forge-ai — check  (6 gates, cheapest first)

  ✓ types     4.7s · the contract between every module
  ✓ lint      9.7s · a red lint hides the next real error
  ✓ test      3.4s · 561 assertions — the pieces
  ✓ e2e      15.8s · 32 assertions — whether the pieces fit together
  ✓ eval      4.0s · retrieval is at recall@3 = 100%, so this can only detect DAMAGE
  — verify         skipped: no ANTHROPIC_API_KEY

  all gates passed
```

Ordered cheapest-first and stops at the first failure, printing that gate's own
output. `verify` spends real money so it stays opt-in (`FORGE_VERIFY=1`) even when a
credential exists.

To run it automatically before every push:

```bash
pnpm hooks      # sets core.hooksPath to .githooks
```

That is local git config, so a fresh clone needs it once. The same gate also runs in
CI ([.github/workflows/check.yml](.github/workflows/check.yml)), which is the copy
that cannot be skipped with `--no-verify`. See
[Experiment 022](experiments/022-continuous-verification/README.md).

Running the gate is not the same as seeing whether it passed — 026 found that CI ran
three times and failed three times while nothing local noticed. `pnpm ci-status` reads
the check run for the current commit from the public GitHub API (no credential
needed) and exits non-zero if it isn't green:

```bash
pnpm ci-status
```

```text
forge-ai — ci-status  (IsaacKalambo22/forge-ai @ 69e20d2)

  ✓ check      success  https://github.com/IsaacKalambo22/forge-ai/actions/runs/...
```

See [Experiment 027](experiments/027-ci-visibility/README.md).

## Index cost

The notebook index is rebuilt on startup and embedding it is the slowest thing this
process does. Since Experiment 024 the vectors are cached in SQLite, keyed by a hash of
the text and the model:

| | cold | warm |
| --- | --- | --- |
| build | 66.9 s – 196.8 s | **0.036 s** |

The cold spread is machine load, not code — see the correction in
[Experiment 024](experiments/024-affordable-index/README.md). What is solid is the
ratio: a warm build is three to four orders of magnitude faster, reproduced across
runs.

Caching removes the repeat cost — a chunk whose text has not changed is never
re-embedded, and because the key is the *text*, moving a section between files costs
nothing.

Batching (16 at a time rather than one call with all 285 chunks) is the other half, and
much larger than it looks. A batch is padded to its longest member, so one long passage
inflates every other text in the call. Interleaved A/B, two runs per arm:

```text
unbatched   17.7 min / 16.6 min        peak RSS ~833 MB
batched        56 s  /    58 s         peak RSS  424 MB
```

**~18×.** The unbatched path also degrades faster than the corpus grows: 11% more
chunks cost 99% more time. An earlier version of this README claimed 2.6× from a
badly-controlled measurement — see the correction in
[Experiment 024](experiments/024-affordable-index/README.md).

Cached vectors are bit-identical to fresh ones (cosine `1.000000000`, max component
delta `0.00e+0`), and `pnpm eval` confirms retrieval is unchanged.

While the index is building, `/api/ask` and `/api/agent` return **503 with
`Retry-After`** rather than waiting in silence. See
[Experiment 024](experiments/024-affordable-index/README.md).

## End-to-end

Every route used to be checked by hand with `curl` — 500+ unit assertions proved the
pieces, and nothing proved they fit together:

```bash
pnpm e2e
```

Starts a server on its own throwaway database, registers real users, and drives the
app through the front door: auth, validation, streaming, conversation persistence,
cross-user authorization, session revocation, and structured logging. **32 assertions,
no API credential required.**

The redaction check is the one worth noting — the unit tests prove `redact()` works;
this proves nothing tried to log a secret in the first place.

## Evaluating retrieval

Retrieval quality is a number, not an impression:

```bash
pnpm eval
```

Loads the local embedding model (no API key, no network) and scores the same
`searchLessons()` the app calls against 16 labelled queries, beside a naive
word-overlap baseline:

```text
  metric                          lexical    dense
  ------------------------------ -------- --------
  recall@3  (what /api/ask uses)      69%     100%
  precision@3                         23%      35%   (ceiling 35%)
  MRR                               0.736    0.896
```

The average understates the point. The whole gap is paraphrase — on
`"My agent keeps going round and round and won't stop"`, whose matching lesson shares
no content words with it, lexical ranks the answer **16th of 16** and the embedding
ranks it **1st**.

See [Experiment 013](experiments/013-evaluation/README.md), including the run where
the benchmark's own integrity test caught four of the sixteen queries copying their
wording from the answers they were meant to find.

## Project structure

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Server Component — renders the chat island
│   ├── chat.tsx              # Client Component — input, state, fetch
│   ├── ask.tsx               # Client Component — RAG over the notebook
│   ├── login.tsx             # Client Component — password form (shown only when locked)
│   └── api/
│       ├── login/
│       │   └── route.ts      # POST sign in · PUT register · DELETE sign out
│       ├── agent/
│       │   └── route.ts      # POST /api/agent — model chooses its own context
│       ├── ask/
│       │   └── route.ts      # POST /api/ask — RAG: retrieve, prompt, stream
│       ├── search/
│       │   └── route.ts      # POST /api/search — semantic search, no API key needed
│       ├── analyze/
│       │   └── route.ts      # POST /api/analyze — structured output, real status codes
│       ├── metrics/
│       │   └── route.ts      # GET  /api/metrics — latency percentiles, status counts
│       └── chat/
│           └── route.ts      # POST /api/chat — the trust boundary, NDJSON stream
└── lib/
    ├── analysis.ts           # zod schema + inferred type — client-safe
    ├── messages.ts           # ChatMessage type, MAX_TURNS, validator — client-safe
    ├── personas.ts           # persona ids — safe for the browser
    ├── expression.ts         # pure arithmetic parser — no imports, no privileges
    ├── vector.ts             # cosine similarity + topK — no imports, no privileges
    ├── chunk.ts              # markdown chunker — no imports, no privileges
    ├── agent.ts              # stopping policy — no imports, no privileges
    ├── passage.ts            # nonce-fenced passage rendering — no imports
    ├── ratelimit.ts          # token bucket — no imports, injected clock
    ├── guard.ts              # "server-only": auth + rate limit + daily budget
    ├── session.ts            # signed session tokens — secret injected, testable
    ├── knowledge.ts          # "server-only": the notebook index (65 chunks)
    ├── corpus.ts             # the searchable lessons — client-safe
    ├── metrics.ts            # recall@k, precision@k, MRR — no imports
    ├── evalset.ts            # 16 labelled queries — the benchmark's judgement
    ├── stats.ts              # percentiles — no imports, no privileges
    ├── log.ts                # structured JSON lines + redaction — no imports
    ├── telemetry.ts          # bounded ring buffer + snapshot — pure core
    ├── observe.ts            # "server-only": id, timer, log, leak-free failures
    ├── db.ts                 # "server-only": SQLite + versioned migrations
    ├── transcripts.ts        # "server-only": server-owned conversations
    ├── revocation.ts         # "server-only": session denylist (hashes, not tokens)
    ├── users.ts              # "server-only": scrypt passwords, timing-equalised auth
    ├── pricing.ts            # token rates + integer-nanodollar cost — no imports
    ├── context.ts            # token estimation, window, cost projection — no imports
    ├── claims.ts             # the verification debt as data + pure evaluators
    ├── ndjson.ts             # the ONE NDJSON reader — chat, ask, e2e all share it
    ├── embedcache.ts         # "server-only": content-addressed vector cache (own DB)
    ├── once.ts               # share one in-flight load; forget a failed one
    ├── usage.ts              # "server-only": the spend ledger
    ├── embeddings.ts         # "server-only": local embedding model
    ├── search.ts             # "server-only": cached corpus index
    ├── tools.ts              # "server-only": tool definitions + execution
    └── ai.ts                 # "server-only": prompt text, SDK, API key, tool loop

docs/                         # Architecture, glossary, running notes
experiments/                  # One directory per experiment, each with its own README
scripts/                      # `pnpm eval` · `cost` · `verify` · `e2e` · `warm` · `check`
tests/                        # `pnpm test` — 471 assertions, no framework
.data/forge.db                # SQLite — users, transcripts, sessions, usage
.data/embeddings.db           # derived: the embedding cache, safe to delete or share
```

## Architecture

```text
User
  │
  ▼
Browser  ·  chat.tsx ("use client")          ← untrusted: the user controls this
  │
  │  POST /api/chat   { conversation_id?, message, persona? }
  │  ← NDJSON stream: {type:"conversation"} {type:"text"} … {type:"done"}
  ▼ ─────────────────────────────────────────  trust boundary
Server   ·  app/api/chat/route.ts            ← trusted: the user cannot read or edit this
  │                                             guard() → Identity { userId }   (016)
  │                                             readable(id, userId) → 404      (016)
  │
  ▼
AI Service  ·  lib/ai.ts                     ← holds ANTHROPIC_API_KEY
  │
  ▼
LLM Provider  ·  api.anthropic.com/v1/messages
```

The browser never holds the API key, and never talks to Anthropic directly. To call
the API a request needs an `x-api-key` header — and anything the browser can send, the
user can read from DevTools in about two seconds. No obfuscation changes that; the
browser must hold the plaintext key in order to send it.

The boundary is not just about hiding a string. It is the only place control logic can
live, because it is the only code the user cannot edit: the system prompt, the model
choice, `max_tokens`, rate limits, and the bill all depend on it. Every defence added
later — auth, quotas, logging, tool permissions — hangs off this line.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the versioned architecture record,
[docs/GLOSSARY.md](docs/GLOSSARY.md) for terminology, and
[docs/AI-ENGINEERING-NOTES.md](docs/AI-ENGINEERING-NOTES.md) for the running concept
notes — the long-term reference, organised by concept rather than by experiment.

## Experiments

Each experiment is a self-contained question with its own README recording the
objective, observations, lessons, and the questions that remain unanswered. The README
is the deliverable; the code is the apparatus.

| # | Experiment | Status |
| --- | --- | --- |
| 001 | [Basic LLM Request](experiments/001-basic-llm/README.md) | 🟢 Working — UI + route verified; real-key questions open |
| 002 | [Prompt Engineering (system prompts)](experiments/002-prompt-engineering/README.md) | 🟢 Working — server-owned personas; model behaviour unverified |
| 003 | [Conversation History](experiments/003-conversation-history/README.md) | 🟢 Working — stateless API, client-held history, server turn cap |
| 004 | [Streaming](experiments/004-streaming/README.md) | 🟢 Working — NDJSON stream; real deltas unobserved |
| 005 | [Structured Output](experiments/005-structured-output/README.md) | 🟢 Working — schema verified on the wire; model conformance unobserved |
| 006 | [Tool Calling](experiments/006-tool-calling/README.md) | 🟢 Working — loop built, evaluator 28/28; loop never executed |
| 007 | [Embeddings](experiments/007-embeddings/README.md) | 🟢 **Verified end-to-end** — local model, semantic search working |
| 008 | [RAG](experiments/008-rag/README.md) | 🟢 Retrieval **verified** (top-4 5/7→7/7); generation unobserved |
| 009 | [Agent](experiments/009-agent/README.md) | 🟢 Loop built, stopping policy 12/12; loop never executed |
| 010 | [Prompt Injection](experiments/010-prompt-injection/README.md) | 🟢 **Real vulnerability found and fixed** — 0/4 → 12/12 |
| 011 | [Auth, Rate Limiting & Cost Control](experiments/011-auth-and-limits/README.md) | 🟢 **Verified end-to-end** — limiter 21/21, prod fails closed |
| 012 | [Test Suite & Sessions](experiments/012-testing-and-sessions/README.md) | 🟢 **Verified end-to-end** — `pnpm test` 199/199, session flow working |
| 013 | [Evaluation](experiments/013-evaluation/README.md) | 🟢 **Verified end-to-end** — `pnpm eval`: recall@3 100%, MRR 0.896 vs 0.736 lexical |
| 014 | [Observability](experiments/014-observability/README.md) | 🟢 **Verified end-to-end** — correlation ids, p50 6ms / p95 1579ms; **Exp. 001 provider leak closed** |
| 015 | [Persistence](experiments/015-persistence/README.md) | 🟢 **Verified end-to-end** — SQLite; **Exp. 003 forgery and Exp. 012 revocation both closed** |
| 016 | [Identity & Authorization](experiments/016-identity-and-authz/README.md) | 🟢 **Verified end-to-end** — cross-user access returns 404, byte-identical to nonexistent |
| 017 | [Cost & Token Accounting](experiments/017-cost-accounting/README.md) | 🟢 **Enforcement verified** — budgets in dollars, integer-nanodollar ledger; live `usage` still blocked |
| 018 | [Context Management](experiments/018-context-management/README.md) | 🟢 **Projection verified** — prefix caching 53% cheaper at 20 turns, lossless; a real cache hit still blocked |
| 019 | [Agent-Loop Context](experiments/019-agent-context/README.md) | 🟢 **Projection verified** — pruning 60% cheaper; **pruning + caching is worse than either alone** |
| 020 | [Verification Debt](experiments/020-verification-debt/README.md) | 🟢 **Harness verified** — 9 fixture-tested evaluators; the debt is now redeemable in one command |
| 021 | [End-to-End](experiments/021-end-to-end/README.md) | 🟢 **Verified** — first e2e suite, 32 assertions; `pnpm verify` now 9/9; a process leak found and fixed |
| 022 | [Continuous Verification](experiments/022-continuous-verification/README.md) | 🟢 **Verified** — `pnpm check` gate (~38s), pre-push hook fires; CI written, not yet run |
| 023 | [Injection, Beyond the Unit Test](experiments/023-injection-end-to-end/README.md) | 🟢 **Verified** — the corpus really contains payloads; renderer holds. Surfaced an 8.6-min index build |
| 024 | [Affordable Index](experiments/024-affordable-index/README.md) | 🟢 **Measured** — caching: ~40ms warm vs ~56s cold; batching: **~18×** and half the RSS (first attempt measured 2.6× from noise) |
| 025 | [Warm Index](experiments/025-warm-index/README.md) | 🟢 **Verified** — derived data split from app state, deleting two bugs; boot warm-up's route-boundary gap found in [033](experiments/033-metrics-time-range/README.md), fixed in [034](experiments/034-index-wait-not-check/README.md) |
| 026 | [CI Was Never Green](experiments/026-ci-was-never-green/README.md) | 🟢 **Fixed and confirmed** — green on the push that followed |
| 027 | [CI Result Visibility](experiments/027-ci-visibility/README.md) | 🟢 **Confirmed** — `pnpm ci-status` + badge, green against the push that added them |
| 028 | [Usage Recording on ask / agent / analyze](experiments/028-usage-everywhere/README.md) | 🟡 **Wired, CI-green** — the wiring compiled, linted and passed on GitHub; observing a real recorded row still needs the missing credential |
| 029 | [Per-User Rate Limiting](experiments/029-per-user-rate-limit/README.md) | 🟢 **Verified** — 64 new unit assertions; identity, not IP, now bounds the same user |
| 030 | [Professional UI Shell](experiments/030-professional-ui-shell/README.md) | 🟢 **Verified** — design tokens, shared primitives, `/metrics`; `chat.tsx` state extracted and tested (32 assertions) |
| 031 | [/api/ask Prefix Caching](experiments/031-ask-prefix-caching/README.md) | 🟡 **Request shape verified** — breakpoint lands only on the request-invariant preamble; real cache hit blocked (credential) |
| 032 | [Minimum-Cacheable-Prefix Guard](experiments/032-cache-minimum-guard/README.md) | 🟢 **Measured and fixed** — `ASK_SYSTEM_PREAMBLE` was ~122 tokens vs. a 1024 floor, paying the write premium for nothing; both caching sites now gated |
| 033 | [/metrics Time Range, and a Deeper Bug](experiments/033-metrics-time-range/README.md) | 🟢 **Feature shipped; bug found and fixed in 034** — `/metrics` was silently reading an always-empty module instance (fixed here); uncovered that 025's boot warm-up never reaches the routes that serve real traffic |
| 034 | [Wait for the Index, Don't Just Check It](experiments/034-index-wait-not-check/README.md) | 🟢 **Verified live** — a fresh server's first `/api/ask`/`/api/agent` now succeeds (200, real sources) instead of a spurious 503 |
| 035 | [Which Layer Owns the Latency](experiments/035-retrieval-tracing/README.md) | 🟢 **Verified live** — retrieval now has its own `/metrics` row; confirmed the route-level timer for a streaming route measures time-to-first-byte (~7ms), not real work (~15-680ms) |
| 036 | [Testing the Boundary Itself](experiments/036-guard-unit-tests/README.md) | 🟢 **Verified** — 44 new assertions on `guard.ts` (auth, rate limiting, budget), previously untested; found and fixed the reason why (coupling to a DB singleton, not neglect) |
| 037 | [Closing the Ceiling's Lip](experiments/037-budget-reservation/README.md) | 🟢 **Verified** — a spending reservation staked before the model call, not after; a second concurrent request is now refused with $0 recorded on either side |
| 038 | [Making the Display Agree With the Check](experiments/038-budget-status-reservations/README.md) | 🟢 **Verified live** — `/metrics`'s budget tiles now include outstanding reservations, not just recorded spend; watched `reserved` move from $0 to $0.0256 and back across a real request |
| 039 | [Making `indexReady()` Actually Cross-Layer](experiments/039-index-ready-cross-layer/README.md) | 🟢 **Verified live** — the badge reads the shared embedding cache instead of a per-layer flag; confirmed `ready` flips true from a build that ran entirely in a different module instance |
| 040 | [The CSRF Token That Isn't Needed](experiments/040-csrf-audit/README.md) | 🟢 **Audited, closed** — every cookie is `SameSite=Strict` from one code path, the one state-changing `PUT` never reads it, no CORS widens either; no token added |
| 041 | [A Real Browser, Not Just curl](experiments/041-headless-browser-verification/README.md) | 🟢 **Verified** — `pnpm visual`, 12 assertions through real headless Chromium; found and worked around a mac13 install-support gap along the way, wired into `pnpm check` as a skippable gate |
| 042 | [Three of Four](experiments/042-ui-usability-pass/README.md) | 🟡 **Verified live, `e2e`/`visual` queued** — conversation history + switching, mobile input/touch-target fixes, login screen context; visual identity ("not convincing") deliberately left for Isaac to direct |
| 043 | [A Choice, Not Just an Inference](experiments/043-theme-switcher/README.md) | 🟡 **Verified live, `e2e`/`visual` queued** — System/Light/Dark override on the existing dark palette, no reload flash, `useSyncExternalStore` after lint caught a `useState`+`useEffect` anti-pattern |

Beyond the foundation: prompt design → context management → persistence → auth →
rate limiting → observability → evaluation → RAG (017–022) → tool calling (023–027) →
agents (028–033) → production (034–040).

### Deliberately out of scope for v0.1

Streaming · system prompts · conversation history · prompt caching · token counting ·
RAG · vector databases · tool calling · agents · memory · autonomous execution

Each of these is a later experiment. Adding them early would defeat the point.

## Stack

- **Next.js 16** (App Router) with React 19
- **TypeScript**, **Tailwind CSS v4**
- **[@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)** —
  currently calling `claude-opus-5`
