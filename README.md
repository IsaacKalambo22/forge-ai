# ForgeAI

A learning project for AI engineering. The goal is not to ship a product — it is to
understand each layer of an LLM application by building it, one deliberate experiment
at a time.

> **Engineering principle:** understand each layer before introducing abstraction.

## Status

**Experiments 001–015 complete.** `pnpm test` → 315/315. `pnpm lint` and
`npx tsc --noEmit` → clean.

Currently building: **Experiment 016 — Identity and Authorization.**

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
- [x] Test suite — 315 assertions, no framework
- [x] Evaluation — `pnpm eval`, a scored retrieval benchmark with a baseline
- [x] Observability — structured logs, redaction, correlation ids, `GET /api/metrics`
- [x] Persistence — SQLite transcripts and session revocation, zero new dependencies

### Currently building

- [ ] **016 — Identity and Authorization.** 015 made conversations durable and left
      them unowned: the project authenticates (*is this a valid session?*) but does
      not authorize (*is this conversation yours?*). Needs real users, retiring
      Experiment 012's "one password, no users".

### Blocked — no Anthropic API credential

Everything downstream of a live model call is built and type-checked but **never
observed**: real `usage` / `stop_reason`, persona effects, schema conformance, the
tool loop, the agent loop, generation quality.

> A Claude.ai or ChatGPT **subscription is not an API credential.** They are separate
> accounts with separate billing. See [Setup](#setup).

This is recorded, not worked around. Retrieval is measurable *because* it was
separated from generation.

### Deferred

- [ ] Tracing — which layer owns the latency, not just the total
- [ ] Log shipping and retention — stdout is enough for one process, not two
- [ ] Token counts / cost per request — blocked on the credential, not on design
- [ ] CSRF token
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

### 3. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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
│       │   └── route.ts      # POST sign in · DELETE sign out
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
    ├── embeddings.ts         # "server-only": local embedding model
    ├── search.ts             # "server-only": cached corpus index
    ├── tools.ts              # "server-only": tool definitions + execution
    └── ai.ts                 # "server-only": prompt text, SDK, API key, tool loop

docs/                         # Architecture, glossary, running notes
experiments/                  # One directory per experiment, each with its own README
scripts/                      # `pnpm eval` — the retrieval benchmark
tests/                        # `pnpm test` — 315 assertions, no framework
.data/forge.db                # SQLite — git-ignored, created on first run
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
