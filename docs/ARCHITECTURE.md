# ForgeAI Architecture

## Version

v0.1

## Current architecture

```text
User
  |
  v
Next.js Application
  |
  v
AI Service
  |
  v
LLM Provider
```

## Current goal

Build a minimal AI application that allows me to understand how an application communicates with an LLM.

## Deliberately excluded for v0.1

* RAG
* Vector database
* Agents
* Tool calling
* Memory
* Autonomous execution
* Code modification

These will be introduced later as separate engineering challenges.

## Trust levels of modules (added in Experiment 002)

```text
src/lib/messages.ts   type + cap + validator       → either side may import
src/lib/personas.ts   ids only                     → either side may import
src/lib/ai.ts         prompt text, SDK, API key    → "server-only", build error if
                                                     imported from a Client Component
```

An import pulls in the whole module and its import graph — trust level is a property of
the *file*, not of the value you named. Split files by what may reach the browser.
`import type` is the exception: it is erased at compile time and ships nothing.

## Conversation state (added in Experiment 003)

The Messages API is stateless. The conversation lives in the browser's React state and
is resent in full on every request. Consequences, both recorded as deliberate v0.1
trade-offs:

* input tokens grow quadratically with conversation length — capped at `MAX_TURNS` in
  the route, the only place the user cannot edit;
* a client-supplied `assistant` turn is an unverifiable claim. Server-side transcript
  storage is deferred until persistence and identity exist.

## Error handling boundary (added in Experiment 004)

The HTTP status line is committed with the first byte of the response, so a streaming
endpoint has two distinct error régimes:

```text
parse body · validate messages · validate persona   → real status codes (400)
──────────────── first byte of the response ────────────────
model call · deltas · finalMessage()                → HTTP 200, errors as {type:"error"}
```

Everything cheap to check belongs above that line, while a status code is still
available to us.

## Tool execution (added in Experiment 006)

```text
user text → model → tool arguments → server-side execution
```

Tool arguments are user-*influenced* input arriving indirectly, executed with the
server's privileges. Two structural rules follow:

* pure logic lives in modules with no imports and no privileges (`expression.ts`), so it
  is exhaustively testable and the privileged surface stays small;
* a tool must not be able to express anything beyond its purpose. `calculate` uses a
  parser, never `eval` — measured, `eval` reads the whole environment including the
  API key.

The loop is capped at `MAX_TOOL_ITERATIONS`, because each pass is a paid request and the
model, not the application, decides whether to continue.

## Retrieval (added in Experiment 008)

```text
notebook markdown → chunk on headings → embed (local model) → cosine top-k
                                                                   ↓
                                    fenced <passage> blocks in the SYSTEM prompt
```

The index is built once at startup and cached behind a promise. Sections that cannot
answer a question (`Questions`, `Future questions`, `Objective`) are excluded — measured,
that took top-4 recall from 5/7 to 7/7.

Retrieved text enters the system prompt, the highest-authority channel in the request.

**Experiment 010 found that the original fencing did not fence.** A corpus entry
containing `</passage>` escaped its own block and forged a second one marked trusted —
string concatenation with untrusted input, the same class of bug as SQL injection.

Passages are now rendered by `src/lib/passage.ts` with a **random nonce per request**
(`<passage-d9877091f553d118>`), plus neutralisation of any lookalike tag and filtering of
attribute values. The nonce is the load-bearing defence: an attacker writes their payload
before the nonce exists, so they cannot close the block.

Defences are classified deliberately:

* **structural** — nonce delimiters, attribute filtering, read-only tools, the arithmetic
  parser. These hold whether or not the model cooperates, and are tested.
* **behavioural** — "treat this as data", "cite your sources", "say so if you don't know".
  These are *requests*. None has been observed.

## Access control (added in Experiment 011)

Every route begins with `guard(request, route)` — before body parsing, and before the
first byte of any stream.

```text
authentication   APP_SECRET + Bearer token, constant-time compare
                 unset in dev  → open
                 unset in prod → 503, fail closed
per-caller       token bucket, capacity 20, refill 1/3 per second
global budget    200 paid requests, refilling over 24h
```

Cost is weighted by what a route actually spends: `search` 0, `chat`/`analyze`/`ask` 1,
`agent` **6** (one call can be six paid requests). Free routes still cost 1 against the
per-caller limit, because CPU is a resource too.

State is in memory: it resets on restart and is not shared between instances. This bounds
accidents and casual abuse, not a determined attacker against a scaled deployment.

A shared secret cannot authenticate the browser — the browser would have to hold it, which
is Experiment 001's lesson. Session authentication is the missing piece.

## Engineering principle

Understand each layer before introducing abstraction.
