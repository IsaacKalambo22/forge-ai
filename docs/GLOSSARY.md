LLM
API
SDK
Prompt
Context
Token
Context window
Embedding
Vector database
RAG
Tool calling
Agent
Inference
Streaming
Structured output
Hallucination
Evaluation
---

## Defined so far

**Route Handler** — server-side code that receives an HTTP request and returns an HTTP
response. In the App Router the file must be named `route.ts`; the *exported function
name* (`POST`, `GET`) defines which methods are routed to it.

**Server Component** — the default in the App Router. Runs only on the server, ships no
JavaScript for itself, and may read secrets.

**Client Component** — a file starting with `"use client"`. Its code is sent to the
browser so React can attach event handlers. Required for `useState`, `onClick`, and
browser APIs. Everything in it is readable by the user.

**Hydration** — React attaching event handlers to already-rendered HTML, turning a
static page into an interactive one.

**Content block** — the Anthropic API returns `content` as an *array* of typed blocks
(`text`, and later `thinking` / `tool_use`), never a bare string.
