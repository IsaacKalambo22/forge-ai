# ForgeAI

A learning project for AI engineering. The goal is not to ship a product — it is to
understand each layer of an LLM application by building it, one deliberate experiment
at a time.

> **Engineering principle:** understand each layer before introducing abstraction.

## Status

**Experiment 001 — Basic LLM Request.** In progress.

| Piece | State |
| --- | --- |
| `POST /api/chat` route handler | ✅ Implemented, validation verified |
| `askClaude()` provider adapter | ✅ Implemented |
| Anthropic API key | ⛔ Not yet configured — see [Setup](#setup) |
| Chat UI in `page.tsx` | ⬜ Not started |

Until a real API key is in place, the endpoint validates input correctly but cannot
reach the model. This is expected, and the failure is documented below.

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

Returns `{"error":"Message is required"}` with HTTP 400. The same 400 is returned for
a missing field, a whitespace-only string, or a non-string value. A `GET` to the same
URL returns 405 — Next derives that from the fact that only `POST` is exported.

**Model call (requires an API key):**

```bash
curl -s -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in one sentence."}' | python3 -m json.tool
```

The route currently returns the **raw Anthropic `Message` object** so the response can
be inspected. Four fields are worth reading every time:

| Field | What it tells you |
| --- | --- |
| `content` | An **array of blocks**, not a string. Narrow on `block.type === "text"`. |
| `usage` | Input and output token counts — the basis of cost. |
| `stop_reason` | `end_turn` normally; `max_tokens` when the 1024 ceiling truncates it. |
| `model` | Which model actually served the request. |

### Known failure: no API key

With a placeholder or missing key, the model call returns **HTTP 500**, while the
server log shows the real cause:

```text
Error: 401 {"type":"error","error":{"type":"authentication_error",
"message":"invalid x-api-key"}}
```

**Updated in Step 2:** the route now catches this and returns **HTTP 502** with the
provider's message, so the failure is visible in the browser instead of only in the
server log. 502 rather than 500, because the server is fine — the service it depends
on is not.

Forwarding the provider's text is a deliberate development-time trade-off. It is how
the 401 gets diagnosed from `curl`, but in production it leaks which provider is in use.
Logging it server-side and returning a correlation id instead is *deferred — revisit
later*.

## Project structure

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Server Component — renders the chat island
│   ├── chat.tsx              # Client Component — input, state, fetch
│   └── api/
│       └── chat/
│           └── route.ts      # POST /api/chat — the trust boundary
└── lib/
    ├── messages.ts           # ChatMessage type, MAX_TURNS, validator — client-safe
    ├── personas.ts           # persona ids — safe for the browser
    └── ai.ts                 # "server-only": prompt text, SDK, API key

docs/                         # Architecture, glossary, running notes
experiments/                  # One directory per experiment, each with its own README
```

## Architecture

```text
User
  │
  ▼
Browser  ·  chat.tsx ("use client")          ← untrusted: the user controls this
  │
  │  POST /api/chat   { messages[], persona }
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the versioned architecture record
and [docs/GLOSSARY.md](docs/GLOSSARY.md) for terminology.

## Experiments

Each experiment is a self-contained question with its own README recording the
objective, observations, lessons, and the questions that remain unanswered. The README
is the deliverable; the code is the apparatus.

| # | Experiment | Status |
| --- | --- | --- |
| 001 | [Basic LLM Request](experiments/001-basic-llm/README.md) | 🟢 Working — UI + route verified; real-key questions open |
| 002 | [Prompt Engineering (system prompts)](experiments/002-prompt-engineering/README.md) | 🟢 Working — server-owned personas; model behaviour unverified |
| 003 | [Conversation History](experiments/003-conversation-history/README.md) | 🟢 Working — stateless API, client-held history, server turn cap |
| 004 | Streaming | ⚪ Next |
| 005 | Error handling & status codes | ⚪ (partly done in 001) |
| 006 | Structured outputs | ⚪ |
| 007 | Token usage & cost | ⚪ |
| 008 | Model selection | ⚪ |

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
