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

## Engineering principle

Understand each layer before introducing abstraction.
