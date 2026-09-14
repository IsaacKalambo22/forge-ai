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

**System prompt** — the top-level `system` parameter on `messages.create()`. A standing
instruction applied to every turn, separate from the `messages` array. Sets role, tone,
format and limits.

**Allowlist** — validating input against a fixed set of known-good values rather than
trying to filter out bad ones. The client names a choice; the server owns what it means.

**`server-only`** — a Next.js import that makes a module a build error if a Client
Component pulls it in. Requires no npm install; Next resolves it internally.

**Stateless** — the API retains nothing between calls. Every request must carry the
entire conversation; the model has no memory of the previous one.

**Context** — everything the model can see on a single request: the system prompt plus
the full `messages` array. Nothing outside it exists to the model.

**`import type`** — a TypeScript import erased at compile time. Naming a type from a
heavy library costs the bundle nothing; a value import from the same module does not.

**Streaming** — writing the response body incrementally while the model generates,
instead of sending it once complete.

**NDJSON** — newline-delimited JSON: one complete JSON object per line. A simple
streaming wire format.

**SSE (Server-Sent Events)** — the standard streaming format, with `data:` framing and
automatic reconnection via `EventSource`. What the Anthropic API itself sends.

**Chunked transfer encoding** — an HTTP response sent without `Content-Length`, because
the total size is unknown when the headers are written. What makes streaming possible.

**Delta** — one incremental piece of a streamed response. Text deltas carry text only;
totals like `usage` and `stop_reason` arrive at the end.

**Structured output** — constraining the model to return JSON matching a schema
(`output_config.format`), so the result is a typed object rather than prose.

**JSON Schema** — the vocabulary used to describe that shape. `additionalProperties:
false` forbids extra keys; `required` lists fields that must be present.

**Strict** — a schema the model's output is guaranteed to conform to, rather than merely
encouraged toward.

**Tool calling** — the model ends its turn with `stop_reason: "tool_use"` to request that
your code run something. It cannot execute anything itself; it can only ask.

**Agentic loop** — request → execute tool → append result → send again, until the model
stops asking. Each pass is a paid API request.

**`tool_use` / `tool_result`** — paired content blocks. The `tool_use_id` on a result is
what matches it to the request.

**`is_error`** — a flag on a tool result telling the model the tool failed, so it can
correct itself rather than treating garbage as fact.

**Embedding** — a fixed-length list of numbers representing a piece of text, positioned so
that similar meanings point in similar directions. Here 384 numbers, normalised to
length 1.

**Cosine similarity** — the cosine of the angle between two vectors, ignoring their
lengths. 1 = same direction, 0 = unrelated, -1 = opposite.

**Semantic search** — retrieval by meaning rather than shared words. Finds a document
with no keywords in common with the query.

**top-k** — returning the k closest results rather than only the best one, because the
best one is often wrong and the right one is usually nearby.

**RAG (Retrieval-Augmented Generation)** — retrieving relevant passages and putting them
in the prompt so the model can answer from documents it was never trained on.

**Chunking** — splitting a document into retrievable pieces. Splitting on the author's
own boundaries (headings) beats splitting on a character count.

**Corpus curation** — deciding what belongs in the index. Removing passages that cannot
answer anything measurably improved recall here, more than any model change.

**Retrieval evaluation** — scoring a fixed set of queries against the passages that ought
to answer them. Without it, "retrieval feels good" is not a claim.

**Agent** — a loop in which the model chooses its own context and next action, rather than
answering one question from context it was handed.

**Step budget** — a ceiling on agent iterations. Each step is a paid request and the
model, not the application, decides whether to continue.

**No-progress detection** — stopping when the model repeats the same tool calls. A stuck
model will otherwise spend the entire budget.
