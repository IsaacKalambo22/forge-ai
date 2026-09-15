# ForgeAI — AI Engineering Learning Notes

**Purpose:** Personal technical reference for learning AI engineering, LLM application development, prompt engineering, RAG, agents, and production AI systems.

**Approach:** Learn by building experiments, measuring results, breaking things, investigating why they break, and documenting what I learn.

---

# 1. The Big Picture

An AI application is not simply:

```text
User → AI
```

A real AI application usually looks more like:

```text
User
 ↓
Frontend
 ↓
Application Server
 ↓
AI / Application Logic
 ↓
AI Provider API
 ↓
LLM
 ↓
Response
 ↓
Application
 ↓
User
```

For ForgeAI, the initial architecture is:

```text
Browser
   ↓
Next.js
   ↓
Route Handler
   ↓
AI service
   ↓
Anthropic SDK
   ↓
Anthropic API
   ↓
Claude LLM
```

The goal is to understand every layer rather than simply making it work.

---

# 2. AI

**AI = Artificial Intelligence**

A broad field of computing concerned with creating systems capable of performing tasks that normally require aspects of human intelligence.

Examples:

* understanding language
* recognizing images
* making predictions
* planning
* reasoning
* generating content
* making decisions

LLMs are one part of the much larger field of AI.

---

# 3. Machine Learning

**Machine Learning (ML)** is a branch of AI where systems learn patterns from data rather than being explicitly programmed with every rule.

Traditional programming:

```text
Rules + Data
     ↓
  Program
     ↓
  Result
```

Machine learning:

```text
Data + Expected Results
          ↓
       Training
          ↓
        Model
          ↓
     New Prediction
```

LLMs are built using machine-learning techniques.

---

# 4. LLM

**LLM = Large Language Model**

An LLM is a machine-learning model trained on large amounts of text and other data to process and generate language.

Examples include models from:

* Anthropic
* OpenAI
* Google
* Meta
* Mistral

An LLM is the model doing the language-generation work.

Conceptually:

```text
Your application
       ↓
      API
       ↓
      LLM
       ↓
Generated response
```

Important:

**LLM ≠ AI application**

The LLM is only one component of an AI application.

---

# 5. Model

A **model** is the trained computational system that performs the task.

When an API request contains:

```ts
model: "some-model"
```

you are telling the provider which trained model should process your request.

Different models can have different:

* capabilities
* intelligence/reasoning ability
* context limits
* speed
* pricing
* multimodal capabilities

---

# 6. API

**API = Application Programming Interface**

An API defines how one piece of software communicates with another.

For example:

```text
ForgeAI
   │
   │ HTTPS request
   ▼
Anthropic API
   │
   ▼
Claude
```

The API provides a defined interface for sending requests and receiving responses.

An API request generally contains things such as:

```text
Endpoint
Headers
Authentication
Request body
```

The response normally contains:

```text
Status
Response data
Usage information
Errors if something failed
```

---

# 7. HTTP

**HTTP = Hypertext Transfer Protocol**

HTTP is one of the fundamental protocols used for communication across the web.

For example:

```text
POST /api/chat
```

means that a client is sending data to a server.

Common HTTP methods:

```text
GET
POST
PUT
PATCH
DELETE
```

For an AI request, we commonly use:

```text
POST
```

because we're sending data to the AI service.

---

# 8. SDK

**SDK = Software Development Kit**

An SDK is a collection of code provided by a service to make it easier for developers to interact with that service.

Without an SDK, you might manually construct:

```text
HTTP request
 ↓
Authentication headers
 ↓
JSON body
 ↓
POST request
 ↓
Parse JSON response
 ↓
Handle errors
```

With an SDK, you might instead write:

```ts
client.messages.create(...)
```

The SDK handles much of the communication plumbing for you.

### Important distinction

```text
API
=
The interface/service you communicate with

SDK
=
Code that makes communicating with that API easier
```

---

# 9. API Client

An **API client** is the configured object your application uses to communicate with an API.

Example:

```ts
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

Here:

```text
Anthropic SDK
      ↓
Anthropic client
      ↓
Anthropic API
```

The client contains the configuration necessary to make requests.

---

# 10. API Key

An **API key** is a credential used by an application to authenticate with an API.

It should be treated as a secret.

Never:

* commit it to Git
* put it directly in frontend code
* post it publicly
* put it in screenshots
* send it to other people unnecessarily

A common pattern is:

```env
ANTHROPIC_API_KEY=...
```

and then:

```ts
process.env.ANTHROPIC_API_KEY
```

### Important

A Claude/ChatGPT subscription and an API account are not automatically the same thing.

A subscription for using an AI product does not necessarily mean your application has API credits/access.

For ForgeAI, we will handle the API-key/provider setup separately when we reach that stage.

---

# 11. Environment Variables

Environment variables are configuration values supplied to an application from its environment rather than hard-coded into source code.

Example:

```env
DATABASE_URL=...
ANTHROPIC_API_KEY=...
```

Then application code can access them through the environment.

In Next.js:

```ts
process.env.SOME_VARIABLE
```

`.env.local` is commonly used for local development.

### Security principle

Secrets belong on the server.

Do not expose secret values through client-side code.

---

# 12. Server vs Browser

The browser is controlled by the user.

Therefore anything shipped to the browser should be considered visible to the user.

The server is where sensitive operations can be protected.

Bad:

```text
Browser
   ↓
Anthropic API
```

if this requires exposing the API key.

Better:

```text
Browser
   ↓
Your Server
   ↓
Anthropic API
```

The server holds the secret.

---

# 13. Route Handler

A **Route Handler** in Next.js allows your application to create server-side HTTP endpoints.

For example:

```text
src/app/api/chat/route.ts
```

can provide:

```text
POST /api/chat
```

The browser can call:

```text
POST /api/chat
```

and the server can then call the AI provider.

Architecture:

```text
Browser
   │
   │ POST /api/chat
   ▼
Next.js Route Handler
   │
   ▼
AI service
   │
   ▼
Anthropic SDK
   │
   ▼
Anthropic API
```

---

# 14. Stateless API

An API request is generally independent unless the application sends context that connects it to previous requests.

For example:

Request 1:

```text
User:
My name is Isaac.
```

Request 2:

```text
User:
What is my name?
```

The second request does not automatically contain the first request.

The application may need to send:

```text
User: My name is Isaac.
Assistant: Nice to meet you, Isaac.
User: What is my name?
```

This means the application is responsible for maintaining the conversation context.

---

# 15. Messages

An LLM request can contain messages representing the conversation.

Example:

```ts
messages: [
  {
    role: "user",
    content: "Explain RAG",
  },
]
```

A multi-turn conversation could look like:

```ts
messages: [
  {
    role: "user",
    content: "My name is Isaac.",
  },
  {
    role: "assistant",
    content: "Nice to meet you, Isaac.",
  },
  {
    role: "user",
    content: "What is my name?",
  },
]
```

The messages array is therefore part of the context supplied to the model.

---

# 16. System Instruction

A **system instruction** provides high-level instructions for how the model should behave.

Conceptually:

```text
System:
You are a concise technical tutor.

User:
Explain RAG.
```

The system instruction establishes the behavior/context before the user's request.

This becomes very important when studying prompt engineering.

---

# 17. Prompt

A **prompt** is the input/instructions given to a model to produce an output.

A prompt can contain:

* instructions
* context
* examples
* constraints
* user input
* desired output format

Simple:

```text
Explain RAG.
```

More structured:

```text
You are a senior software engineer.

Explain RAG to a junior developer.

Use:
1. Simple definition
2. Real-world analogy
3. Technical architecture
4. Small TypeScript example

Keep it under 500 words.
```

---

# 18. Prompt Engineering

**Prompt engineering** is the practice of designing instructions and context to reliably get useful results from a model.

It is more than:

> "Writing a clever prompt."

It involves understanding:

* instructions
* context
* examples
* constraints
* output formats
* ambiguity
* model behavior
* failure cases

The goal is:

```text
Input
 ↓
Well-designed instructions/context
 ↓
More reliable output
```

Eventually we will experiment with prompts scientifically rather than simply writing prompts that "sound good."

---

# 19. Context

**Context** is the information supplied to the model that helps it generate its response.

Context might include:

```text
System instructions
+
Conversation history
+
User question
+
Retrieved documents
+
Tool results
```

For example:

```text
System instruction
       +
Previous conversation
       +
User question
       +
Company policy document
       ↓
      LLM
       ↓
    Answer
```

Context becomes extremely important for RAG and AI agents.

---

# 20. Context Window

The **context window** is the amount of information a model can process within a request.

Conceptually:

```text
┌──────────────────────────┐
│ Context window            │
│                           │
│ System instructions       │
│ Conversation history      │
│ Documents                 │
│ User question             │
│                           │
│ Model output              │
└──────────────────────────┘
```

The exact limits depend on the model.

Large context does not automatically mean the application is well designed.

We need to learn how to provide the **right context**, not simply more context.

---

# 21. Tokens

LLMs process text as **tokens**.

A token is a piece of text used by the model.

A token is not necessarily:

```text
one word
```

or:

```text
one character
```

Depending on the text, a token might represent part of a word, a whole word, punctuation, etc.

Tokens matter because they influence:

* context usage
* cost
* latency
* model limits

Eventually ForgeAI will measure token usage directly.

---

# 22. Input Tokens

The tokens sent **to the model**.

Example:

```text
System instruction
+
Conversation
+
User question
```

all contribute to input tokens.

---

# 23. Output Tokens

The tokens generated **by the model**.

For example:

```text
User:
Explain RAG.

Model:
RAG stands for Retrieval-Augmented Generation...
```

The generated answer contributes to output tokens.

---

# 24. Latency

**Latency** is the time it takes for an operation to produce a result.

For an LLM request:

```text
Request sent
      ↓
     ...
      ↓
Response received
```

We can measure:

```text
2.4 seconds
```

Streaming can make the first part of the answer appear sooner even if the complete response still takes several seconds.

---

# 25. Streaming

Without streaming:

```text
Request
   ↓
Wait
   ↓
Complete answer
   ↓
Display
```

With streaming:

```text
Request
   ↓
First tokens
   ↓
More tokens
   ↓
More tokens
   ↓
Complete answer
```

This improves the perceived responsiveness of AI applications.

We'll experiment with this rather than just reading about it.

---

# 26. RAG

**RAG = Retrieval-Augmented Generation**

RAG allows an application to retrieve relevant information and provide it to the LLM before generating an answer.

Without RAG:

```text
Question
   ↓
LLM
   ↓
Answer
```

With RAG:

```text
Question
   ↓
Search/retrieval
   ↓
Relevant information
   ↓
LLM
   ↓
Answer
```

Example:

Suppose a company has:

```text
Employee Handbook
Loan Policy
Leave Policy
HR Manual
```

A user asks:

> How many leave days do employees receive?

A RAG system can:

```text
Question
   ↓
Search company documents
   ↓
Find relevant leave policy
   ↓
Give relevant section to LLM
   ↓
Generate answer
```

The LLM doesn't have to rely only on its general training knowledge.

---

# 27. Embeddings

An **embedding** is a numerical representation of information that captures semantic relationships.

Text:

```text
"How do I apply for a loan?"
```

can be converted into a vector:

```text
[0.12, -0.42, 0.88, ...]
```

Similar meanings tend to have embeddings that are mathematically closer.

Embeddings are commonly used for semantic search and RAG.

Conceptually:

```text
Document
   ↓
Embedding
   ↓
Vector
   ↓
Vector database/search
```

---

# 28. Vector Database

A vector database stores and searches vectors/embeddings.

Instead of searching only for exact words:

```text
"loan application"
```

semantic search can help find related concepts such as:

```text
"How can I request money from the SACCO?"
```

even if the wording is different.

This is one of the technologies we'll eventually build into ForgeAI.

---

# 29. Tool Calling

Tool calling allows an LLM to request that the application execute a defined function/tool.

Instead of:

```text
User
 ↓
LLM
 ↓
Answer
```

we can have:

```text
User
 ↓
LLM
 ↓
"I need to use the weather tool"
 ↓
Application executes tool
 ↓
Tool result
 ↓
LLM
 ↓
Final answer
```

Tools could include:

```text
getWeather()
searchDatabase()
createInvoice()
checkAccountBalance()
sendEmail()
```

This is one of the foundations of AI agents.

---

# 30. AI Agent

An **AI agent** is an AI system capable of using tools and taking multiple steps toward a goal.

Conceptually:

```text
Goal
 ↓
LLM decides what to do
 ↓
Tool
 ↓
Result
 ↓
LLM decides next step
 ↓
Tool
 ↓
Result
 ↓
Final answer/action
```

An agent is therefore much more than a chatbot.

It can potentially:

* reason about a task
* use tools
* retrieve information
* perform actions
* evaluate results
* continue until the goal is reached

---

# 31. Structured Output

Instead of asking an LLM to return free-form text:

```text
Tell me about this customer.
```

we can require structured data:

```json
{
  "name": "John",
  "risk": "low",
  "recommendedAction": "approve"
}
```

Structured outputs are important when LLM results need to be consumed by software.

For example:

```text
LLM
 ↓
Structured JSON
 ↓
Zod validation
 ↓
Application logic
```

---

# 32. AI Application vs AI Model

This distinction is critical.

The model:

```text
Claude
```

is not the application.

An AI application might contain:

```text
Frontend
Backend
Authentication
Database
RAG
Prompts
LLM
Tools
Business rules
Logging
Evaluation
Billing
Security
```

The LLM is one component.

As an engineer, my goal is to learn how to build the **system around the model**.

---

# 33. Evaluation / Evals

An AI system can appear to work while producing unreliable results. "This answer
looks good" is not a measurement — it has no denominator, no baseline, and no record,
so it cannot say tomorrow whether a change helped or hurt.

Built in Experiment 013. `pnpm eval`.

### Eval set

A fixed list of inputs paired with human judgements of what a correct output is. The
metrics are arithmetic; **the labels are the judgement, and they are the part that can
be silently wrong.**

In ForgeAI: `src/lib/evalset.ts` — 16 queries labelled against the 16 lessons in
`corpus.ts`.

### The three metrics, and why each alone is insufficient

**recall@k** — of the answers that exist, what fraction reached the top k?
*Did we find it.* Raising k can only ever raise recall, so recall alone is gameable:
return the whole corpus and score 1.0.

**precision@k** — of the k returned, what fraction were correct?
*Did we return junk.* The counterweight. Return everything and precision collapses.

**MRR** — mean of 1/(rank of first correct answer). Rank 1 → 1.0, rank 2 → 0.5,
rank 4 → 0.25. The steep drop is deliberate: the app only sends the top k to the
model, so a correct passage at rank 8 is nearly as useless as an absent one.

Recall ignores order; MRR does not. That difference is why both exist.

### Ceiling

The best score attainable given the labels. Most ForgeAI queries have exactly one
relevant lesson, so precision@3 cannot exceed 1/3 for them. **Measured precision@3 was
35% against a ceiling of 35%** — at maximum, not failing. Print the ceiling or the
number gets misread.

### Baseline

A deliberately naive alternative scored on the same set. Without one, a score is
unfalsifiable.

ForgeAI's control is word-overlap ranking. Measured:

```text
                    lexical   dense
recall@3                69%    100%
MRR                   0.736   0.896
```

The average hides where the difference lives. On queries with ordinary word overlap,
the naive baseline is already competitive. **The entire gap is paraphrase**:

```text
"My agent keeps going round and round and won't stop"
    lexical → rank 16 of 16 (worst possible)
    dense   → rank 1
```

The matching lesson ("Cap the agentic loop's iterations… a denial-of-service you
perform on yourself") shares **no content words** with that query. This is what
"semantic" means, demonstrated instead of asserted — and it is the entire
justification for a vector index over keyword search.

Robustness measured directly: dense MRR was 0.889 on deliberately low-overlap queries
against 0.900 on the rest — a gap of 0.011. Paraphrase costs it almost nothing.

### A benchmark needs tests more than ordinary code does

It is code that reports on itself, so a broken one reports success.

`tests/evalset.test.mts` asserts that no query copies more than half its content words
from its own answer. **It failed on first run and named four of my sixteen queries.**
I had written that rule as a comment at the top of the file and broken it within the
hour, because I wrote the queries straight after reading the corpus and the lessons'
phrasing was still in my head.

The leaky queries would have scored *better*. Every one of those points would have
measured string overlap rather than retrieval.

Rules that follow from this:

```text
Write the labels BEFORE running the retriever.
Adjusting labels after seeing output turns a benchmark into a mirror.

Phrase queries from the SYMPTOM, not from the answer.

Test the eval set itself: unknown ids, duplicates, coverage, overlap.
A typo'd label scores 0 forever and looks like a retrieval bug.
```

### What a ceiling-bound benchmark can and cannot do

ForgeAI's recall@3 is 100%. That means this benchmark **can no longer detect
improvement — only damage.** It is a regression alarm, not a gradient. Restoring
discrimination needs harder queries or a bigger corpus.

### What is not measured

Retrieval is not the application. The model still has to *use* the passage correctly,
and measuring that needs an API credential this project does not have. Chunking is
also unmeasured — the harness exists and has not been pointed at it.

Retrieval was measurable at all only because Experiment 007 put the embedding model
in-process. **Separating retrieval from generation is what made half the system
observable without a credential.**

---

# 34. Observability

Evaluation (section 33) asks *is it good?* against a fixed labelled set, offline.
Observability asks the paired question: **what is it actually doing on a request
nobody labelled?**

Built in Experiment 014.

### Structured logging

One JSON object per line, not a prose sentence.

```text
console.log("chat took", ms, "ms")
```

is readable by a human watching one terminal and useless to everything else — it
cannot be filtered, counted, or have a percentile taken of it.

```json
{"level":"info","msg":"request","request_id":"u7z7lyci","route":"analyze",
 "status":502,"ms":2905,"ts":"2026-09-15T07:25:31.329Z"}
```

can be queried by a machine and still read by a person.

### Correlation id

A short random id per request: returned to the client, stamped on every log line for
that request.

It is what lets the server **stop explaining its failures to the client.** The user
reports an opaque `hms069k2`; the operator greps for it; the real cause is there.

In ForgeAI this closed a debt open since Experiment 001. The routes used to return
`Analysis failed: 401 {"type":"error",…"invalid x-api-key"}` — the provider's own
text, announcing the vendor to anyone who poked the endpoint. Now:

```text
client ← {"error":"Analysis failed","request_id":"hms069k2"}
log    → {…,"request_id":"hms069k2","error":"401 {…invalid x-api-key…}"}
```

Not a UUID: it gets read aloud, pasted into chat and screenshotted. 8 base-36
characters is transcribable and unique enough within one log file, which is all it has
to be. It is not a secret.

### Redaction

**Logs get shipped, retained, and read by people who are not you. A log that captures
a secret has copied it somewhere with weaker access control than where it came from.**

Two mechanisms, because neither alone is sufficient:

```text
by KEY NAME     authorization, cookie, x-api-key, password, token, session…
by VALUE SHAPE  sk-ant-…  ·  Bearer …
```

Key-name matching misses a key pasted inside a free-text error message — which is
exactly the shape an LLM provider's failures take. Value-shape matching misses a
session cookie of arbitrary bytes that looks like nothing in particular.

Redaction is defence in depth. The primary control is still *not logging secrets*.

### Percentiles, not averages

**The average hides the tail, and the tail is the user experience.**

Measured on the first ten real `/api/search` requests in ForgeAI:

```text
16, 1579, 9, 16, 25, 6, 6, 0, 1, 1   ms

mean = 166 ms   ← describes NO request in this set
p50  =   6 ms   ← the steady state
p95  = 1579 ms  ← the cold start, loading the embedding model
```

Nine fast requests and one slow one average to something that looks mildly slow
everywhere, when in fact almost everything is instant and one user in ten waits.
p50 says what is typical; p95 finds what the mean buried.

Nearest-rank rather than interpolated, so every number returned is a real measurement
that actually happened — which matters when you are about to go looking for the
request that produced it.

### 4xx is not an error rate

A 400 means the **client** sent something invalid and the server behaved correctly.

```json
"search": {"byStatus": {"200": 6, "400": 4}, "errorRate": 0}
```

Counting 4xx would make this project's health metric read 40% failure because someone
else's script is broken. Only 5xx counts.

### Bound anything that accumulates

An unbounded array of every request is a memory leak with a slow fuse: fine in
development, exhausts the process in production. That is a self-inflicted outage
caused by the code meant to *detect* outages. ForgeAI's telemetry is a fixed-size ring
buffer, and reports `total` (ever seen) separately from `window` (still measurable) so
the window is never mistaken for the truth.

### What a timer actually measures

For the three streaming routes, `ms` stops when the handler returns — and a streaming
handler returns as soon as the stream is *opened*, before the model has produced a
token. So it means **time-to-response-start, not total duration.** It answers "did we
accept the request promptly" and not "how long did the user wait".

A measurement whose meaning is undocumented will be misread. Write down what the
number is, not just what it is called.

### A bug in the tool you debug with

The first correlation id was `Math.random().toString(36).slice(2, 10)`, which
occasionally yields fewer than 8 characters and, for `Math.random() === 0`, an empty
string. An empty correlation id fails **silently**: the user's error page and the log
line simply stop matching, and the one time you need the mechanism is the one time it
is not there.

Negligible probability, one-line fix. **"Unlikely" is a reason not to panic, not a
reason not to fix.**

---

# 35. The ForgeAI Learning Path

The planned progression is:

```text
001  Basic LLM API call
 ↓
002  System instructions
 ↓
003  Conversation and context
 ↓
004  Streaming
 ↓
005  Structured output
 ↓
006  Tool calling
 ↓
007  Embeddings
 ↓
008  RAG
 ↓
009  Evaluation
 ↓
010  AI agent
```

Each experiment should answer:

```text
What am I learning?
Why does it matter?
How does it work?
How do I implement it?
What happens when I change it?
What can go wrong?
What did I learn?
```

---

# 36. My Engineering Philosophy

ForgeAI is not supposed to become another tutorial project.

The objective is to develop the ability to:

1. Understand a technology.
2. Build a minimal implementation.
3. Inspect what is actually happening.
4. Measure behavior.
5. Introduce controlled changes.
6. Observe the results.
7. Investigate failures.
8. Document findings.
9. Apply the knowledge to real-world problems.

The ultimate goal is not:

> "I know how to use an AI SDK."

The goal is:

> **"I understand how AI systems work well enough to design, build, debug, evaluate, and improve them."**

---

# 37. Personal Career Direction

My goal is to grow beyond simply implementing assigned software projects.

I want to become an engineer who can:

```text
Identify real-world problems
        ↓
Understand the problem deeply
        ↓
Design a technical solution
        ↓
Build the solution
        ↓
Test and evaluate it
        ↓
Deploy it
        ↓
Measure its impact
        ↓
Improve it
```

Areas I want to develop deeply:

* SaaS architecture
* Web applications
* Mobile applications
* AI engineering
* LLM applications
* Prompt engineering
* Context engineering
* RAG
* AI agents
* APIs
* databases
* distributed systems
* cloud infrastructure
* security
* system design
* technical problem solving
* research and experimentation

---

# 38. Rule for Learning New Technologies

When encountering a new technical term, ask:

### What is it?

Simple definition.

### Why does it exist?

What problem does it solve?

### Where does it fit?

What part of the architecture uses it?

### How does it work?

Understand the mechanism, not just the syntax.

### How do I implement it?

Build something small.

### What happens if I change it?

Experiment.

### What can go wrong?

Break it deliberately.

### When should I use it?

Understand the trade-offs.

---

# 39. Current ForgeAI Status

**Last updated: 2026-09-15, after Experiment 014.**

Experiments 001–014 are built, documented and tested. `pnpm test` runs 264 assertions
across 14 files and passes. `npx tsc --noEmit` and `pnpm lint` are clean.

Stack:

```text
Next.js 16 (App Router)   React 19   TypeScript   Tailwind v4
@anthropic-ai/sdk   zod   @xenova/transformers (local embeddings)
```

What exists:

```text
src/app/
  page.tsx      Server Component shell
  chat.tsx      streaming chat UI            (001–004)
  ask.tsx       RAG over the notebook        (008)
  login.tsx     password form                (012)
  api/chat      NDJSON streaming             (004)
  api/analyze   structured output            (005)
  api/search    semantic search, no key      (007)
  api/ask       RAG                          (008)
  api/agent     agentic loop                 (009)
  api/login     session issue / revoke       (012)
  api/metrics   latency percentiles          (014)

src/lib/        24 modules — see README for the trust annotations
tests/          264 assertions, no framework
scripts/        pnpm eval — the retrieval benchmark   (013)
```

**The credential position.** `.env.local` still holds the placeholder
`ANTHROPIC_API_KEY=your_actual_key`. This is a deliberate choice, not an oversight.

A Claude.ai or ChatGPT **subscription is not an API credential.** Consumer product
access and API billing are separate accounts with separate payment. Nothing in a
subscription produces an `sk-ant-...` key.

The consequence is recorded honestly throughout: everything downstream of a real
model call is **built and type-checked but not observed**. See section 41.

---

# 40. Current Architecture

```text
Browser  ·  chat.tsx / ask.tsx / login.tsx      ← untrusted: the user controls this
   │
   │  POST  { messages[], persona }   ·   cookie: forge_session
   │  ←     NDJSON stream
   ▼ ──────────────────────────────────────────  trust boundary
Route Handler  ·  app/api/*/route.ts            ← trusted: the user cannot edit this
   │
   ├─→ guard.ts       session check · rate limit · daily budget
   ├─→ passage.ts     nonce-fenced untrusted text        (010)
   ├─→ search.ts ─→ embeddings.ts   local model, no key  (007)
   └─→ ai.ts          ANTHROPIC_API_KEY · system prompts · tool loop
          │
          ▼
       api.anthropic.com/v1/messages
```

The boundary is the whole point. It is the only code the user cannot edit, so it is
the only place the key, the system prompt, the model choice, `max_tokens`, the rate
limit and the bill can live.

---

# 41. What Is Verified, and What Is Not

This distinction matters more than any single lesson here. Three categories, per the
operating rule — never write "working" because the code looks correct.

**Observed — actually executed and watched:**

```text
Validation rejects empty / missing / non-string messages with HTTP 400
A GET to a POST-only route returns 405
Local embeddings run with no API key and no network (007)
Semantic retrieval: top-4 improved 5/7 → 7/7 on a hand-labelled set (008)
The nonce-fence injection defence: 0/4 → 12/12 (010)
Rate limiter 21/21; production fails closed without a secret (011)
Session issue → present → revoke, end to end (012)
Retrieval scored: recall@3 100%, MRR 0.896 vs 0.736 lexical (013)
Correlation id ties client response to server log (014)
Provider-leak fix confirmed in a real production build (014)
Latency p50 6ms / p95 1579ms on real traffic (014)
pnpm test 264/264
```

**Established engineering knowledge — true in general, relied on here:**

```text
The browser cannot hold a secret; anything it can send, the user can read
The Messages API is stateless; the messages array IS the conversation
A signed token is not an encrypted one — the holder may read, not alter
The HTTP status is committed with the first byte, so a stream cannot 502 late
An average hides the tail; a log that captures a secret has moved that secret
A 4xx is the client being wrong, not the server failing
```

**Not yet verified — no API credential configured:**

```text
Any real Anthropic Message rendering in the UI
Real token usage and stop_reason values
Whether personas actually change model behaviour        (002)
Whether the model conforms to the analysis schema       (005)
Whether the tool loop ever executes                     (006)
Whether the agent loop ever executes                    (009)
Generation quality on retrieved passages                (008)
Token counts / cost per request — there has never been a usage object (014)
```

The third list is not a failure. It is an accurate boundary, and drawing it is the
skill. Retrieval was measurable without a key precisely because it was separated
from generation — and so was every observability concern in 014, because latency,
status codes and correlation ids are properties of *this* server, not of the model.

---

# Final Reminder

I am building ForgeAI to become a better engineer.

I should not measure my progress by:

> "How many apps have I built?"

I should also measure it by:

> "How deeply do I understand the systems I build?"

Build.

Measure.

Break.

Investigate.

Document.

Improve.

Repeat.
