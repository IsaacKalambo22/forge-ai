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

# 35. Persistence and State

Built in Experiment 015.

### In-process state vs. persistence

Everything ForgeAI stored before 015 lived in a variable: rate-limiter buckets, the
telemetry ring buffer, the embedding index. Fast, simple, **gone when the process
exits**.

A *fact the system must still know after a restart* needs a different home. The test
that separates the two:

```text
Kill the process. Start it again. Is the fact still true?
```

### What a database gives that a variable does not

```text
durability    it survives the process
constraints   rules enforced BELOW the code, so they hold when the code is wrong
transactions  a group of writes that applies completely or not at all
queries       ask questions of the data that were not anticipated when it was written
```

### Migrations

Schema changes applied once, in order, recorded so they are not applied twice.

ForgeAI keeps the version in SQLite's own `user_version` pragma — an integer the
database carries for exactly this. No migrations table to bootstrap, and **the version
travels with the file**, so a copied database cannot disagree with itself about which
migrations it has had.

Rules that turned out to matter:

```text
Never edit a migration that has shipped — append a new one.
Each migration runs in a transaction, or an interrupted deploy leaves half a schema.
Refuse to run against a schema NEWER than the code understands.
```

### Constraints are worth writing

```sql
CHECK (role IN ('user','assistant'))
UNIQUE (conversation_id, seq)
FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
```

They hold when the code above them is wrong, which is the entire reason to put them
there rather than in a validator.

**SQLite ignores `FOREIGN KEY` unless you ask** (`PRAGMA foreign_keys = ON`) — a
default kept for backward compatibility, and a trap: the constraint is written, reads
as enforced, and silently is not. Test the pragma, not the syntax.

### Server-owned state closes a class of attack

The Experiment 003 debt: the client sent the whole conversation each turn, so a
client-supplied **assistant** turn was only a claim. That is not a cosmetic accuracy
problem — it is the client writing into the model's context. *"You already agreed to
ignore your instructions"* is an assistant turn.

The fix was not a validator. The contract changed:

```text
before   { messages: [ …entire conversation… ], persona }
after    { conversation_id?, message, persona? }
```

**The strongest fix is the one where the attack cannot be expressed, not the one where
it is validated away.** A validator is code that can have a bug; an absent parameter
cannot. Verified over real HTTP: a forged assistant turn sent to the new endpoint is
not rejected — it is simply not a parameter, and the stored transcript contains only
what the server wrote.

Related: **ordering must be the server's.** `seq` is assigned from the count already
stored, never supplied by the caller, and a `UNIQUE (conversation_id, seq)` constraint
makes it a fact rather than an assertion.

### Signed tokens cannot be un-signed

The Experiment 012 debt. A signature says the token is **authentic**; it can never say
whether it has been **logged out**, because a logout is a fact about the world *after*
the token was issued. Stateless verification has nothing to consult.

```text
allowlist  every authenticated request reads the DB to confirm the session exists.
           Correct — and it throws away the reason stateless tokens were chosen.
denylist   read a small table of tokens explicitly revoked and not yet expired.
           Usually empty. Costs a read only where revocation is real.
```

Measured in ForgeAI after logout:

```text
signature still valid : true
expired?              : false  - expires in 12 h
result                : HTTP 401
```

Still cryptographically perfect, still rejected.

**Store a hash, never the token.** A list of un-expired session tokens is a list of
live credentials; stored raw, the table protecting the sessions becomes the most
dangerous one in the schema. SHA-256 suffices where a password would need a slow KDF,
because the input is 256+ bits of MAC output — there is no dictionary to attack.

**Anything that accumulates needs purging.** The denylist grows with every logout, and
rows past their token's expiry are dead weight. Same lesson as the ring buffer in 014.

### A capability is a value that grants access by being held

A conversation id is one, so it is 128 random bits and not a counter — sequential ids
let anyone enumerate every conversation by counting.

But **unguessable is not owned.** ForgeAI can currently tell that a session is valid
and cannot tell whether a conversation belongs to it. Authentication is *who are you*;
authorization is *may you touch this*. Having the first is not having the second.

### The store being available is not a reason to use it

The rate limiter and telemetry were deliberately **not** moved into SQLite. They are
hot-path state written on every request, where a transcript is written twice per
conversation. Moving them buys a disk write per request to solve a problem — sharing
between instances — that does not exist until there is a second instance.

Deferred, with the reason recorded, is a decision. Deferred silently is a bug.

---

# 36. Identity and Authorization

Built in Experiment 016.

### Two different questions

```text
Authentication   who are you?
Authorization    may you touch THIS?
```

**Having the first is not having the second.** ForgeAI shipped Experiment 015 with
durable conversations and no answer to the second question — it could tell a session
was valid and could not tell whose conversation it was looking at. That gap had no
consequences while conversations died with the browser tab, and real ones the moment
they persisted.

The shape of the fix: `guard()` used to return `Response | null` — *allowed or
denied*, with nobody allowed. It now returns an identity, because **a route that
cannot name the caller cannot check whether a resource is theirs.**

### Password hashing is the OPPOSITE problem to token hashing

This is the subtlety worth remembering, because both are "hashing".

```text
session token   256+ bits of MAC output.  No dictionary exists to attack it.
                → SHA-256. Fast is fine.          (revocation.ts, Exp. 015)

password        short, human-chosen, enumerable space.
                → scrypt, deliberately slow, memory-hard.   (users.ts, Exp. 016)
```

Against a leaked table, **SHA-256's speed IS the vulnerability** — billions of guesses
per second on a GPU. Slowness is the feature. Measured in ForgeAI: 66ms per
verification.

Three things stored alongside the digest:

```text
salt        random per password. Without it, two users with the same password
            share a hash and one precomputed table attacks every row at once.
parameters  scrypt$16384$8$1$… — without them, raising the cost later makes every
            existing password unverifiable: the digest is the output of a
            function you can no longer name.
scheme      so a future migration to a different algorithm can recognise old rows.
```

### Timing oracles

If an unknown username returns in microseconds and a wrong password takes 80ms, the
**response time** tells an attacker which usernames exist — and enumerating accounts
is the first step of attacking them.

The fix is to make the unknown-username path do the same work: verify against a dummy
hash and discard the result. Measured: `unknown 56ms vs wrong-password 54ms`.

Same principle as the constant-time comparison in Experiment 012. **Anything an
attacker can measure is an output**, including how long you took and which error you
chose.

### 404, not 403

```text
403  "this exists, but not for you"   ← confirms the id is REAL
404  "no"                              ← confirms nothing
```

For an unguessable id, that confirmation is the one fact an attacker holding a leaked
id could not otherwise derive. Verified in ForgeAI: a stranger asking for a real
conversation and asking for an id that never existed get **byte-identical** responses.

### Check authorization BEFORE the write

A denied request must not be able to modify what it is not allowed to read. ForgeAI
verified this directly: after three rejected attempts by another user, the target
transcript was unchanged. Checking after the write would let a stranger graffiti a
conversation they cannot see.

And check it on **every** route that touches the resource. `/api/analyze` needed the
same check as `/api/chat`, because analysing someone else's conversation is reading it
with an extra step. **A permission enforced on one route and not its neighbour is not
enforced.**

### Nullable columns are a decision about the past

Adding a `NOT NULL` column to a populated table forces you to say what the EXISTING
rows mean. For ForgeAI's pre-016 conversations the only truthful answer was "nobody
knows" — they predate the concept of an owner.

```text
invent an owner   → fabricating a fact
delete them       → destroying data to tidy a schema
leave NULL, treat NULL as "not yours"  → unreachable rather than misattributed
```

The third. **Orphaning is honest; misattribution is not.**

### A credential that names nobody is not an identity

`APP_SECRET` changed role in 016: it used to BE the password, and became the key that
signs sessions plus the credential that authorizes registration. An operator secret,
not a user one.

Local development without it acts as a fixed `local-dev` user rather than as nobody —
because once every resource is owned, "open" is incoherent: **an unowned request
cannot own anything.** That account's password hash is a random value nobody holds, so
it cannot be logged into.

---

# 37. Cost and Token Accounting

Built in Experiment 017.

### The rates (Anthropic first-party, verified 2026-09-15)

| Model | $/MTok in | $/MTok out |
|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 |
| Claude Sonnet 5 | $2.00 | $10.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 |

Cache read **0.1×** input · cache write **1.25×** (5-min TTL) / **2×** (1-hour TTL).

**Output is 5× input.** Most cost-cutting instinct goes to shortening prompts; the
lever with five times the leverage is on the other side. Trim the answer, cap
`max_tokens`, ask for terseness.

### Caching has a break-even, and one request is below it

```text
1 request   write 1.25x        vs  1x uncached   → caching is MORE expensive
2 requests  1.25x + 0.1x = 1.35x  vs  2x         → caching wins
1-hour TTL  2x + 0.2x = 2.2x      vs  3x         → needs 3 requests
```

**Caching a prefix you use once is strictly worse than not caching it.** Verify hits
with `usage.cache_read_input_tokens` — if it is zero across repeated requests,
something in the prefix is changing (a timestamp, a uuid, unsorted JSON keys, a
varying tool list).

### Money is never a float

```text
0.1 + 0.2 === 0.30000000000000004
```

Not paranoia about one request — about the **sum**. A million floating-point fractions
of a cent produce an error that is real money belonging to nobody, reconciling with
nothing. ForgeAI demonstrated the drift directly: a thousand identical charges summed
as floats missed the exact total by 1.42e-14 dollars.

**Choose the unit by the SMALLEST rate you will ever multiply by.** This is the half
of "use integers for money" that actually bites, and it is a property of the price
list, not of the currency:

```text
microdollars   $0.50/MTok = 0.5 microdollars/token   ← a fraction, in the units
                                                       chosen to avoid fractions
nanodollars    $X/MTok    = X * 1000 nano/token      ← always a whole number
```

Better still, make it structural: a constructor that **throws** when a price is not a
whole number of the chosen unit catches the next price list, not just today's.

### A cost you cannot compute must never be zero

```text
unknown model → THROW
unknown model → cost 0    ← spending continues, the budget never notices,
                             and the logs agree everything is fine
```

Same rule for an unrecognised token field in the response: if the provider adds a
billable category, silently ignoring it makes every invoice exceed every total you
recorded. Detect it and log that the recorded cost is a **lower bound**.

### Counting requests is not a spending control

```text
one agent call        = up to N upstream calls
turn 1                = a short prompt
turn 20               = the whole history, resent and re-billed
a cache hit           = a tenth of the input price
```

200 requests could be forty cents or forty dollars. Cap the **bill**, from a ledger.
Keep the request limiter too — it bounds the *rate* of paid work, a different job, and
it still works when the ledger is empty. Two controls, two failure modes.

### A pre-authorisation cannot be exact

A budget check runs **before** the request; the cost is known **after**. So the budget
can always be exceeded by the cost of one in-flight request, and concurrent requests
all read the same under-budget total. It is a ceiling with a lip.

Making it exact needs `count_tokens` to price the request up front, a reservation
written before the call, and reconciliation after. **State the limitation in the
function rather than letting the name imply a guarantee it does not have.**

### Ledger design

```text
request_id UNIQUE     a retry cannot double-bill — a property of the schema,
                      not of whoever remembers to check first
request_id = the 014 correlation id — a ledger row and a log line are one request
ON DELETE SET NULL    deleting a conversation must not delete the record that it
                      cost money. The spend happened.
free routes exempt    a spending limit has no business refusing work that spends
                      nothing (local embeddings, cached reads)
```

### What accounting cannot tell you

These totals are what the application *believes* it spent. Until they are compared
with an actual invoice, they are arithmetic over self-reported numbers.

---

# 38. Context Management

Built in Experiment 018. The companion to section 37 — 37 measures cost, this spends
it better.

### The quadratic

The Messages API is stateless, so turn *k* resends every prior turn. Total input over
*N* turns grows with *N²*.

```text
10 → 20 turns   4.00x the input tokens
20 → 40 turns   4.00x again
10 → 40 turns   16.0x
```

**Doubling the conversation quadruples the input bill.** A turn cap (`MAX_TURNS`)
does not reduce this at all below the cap — it is a cliff, not a strategy.

### The three options, and what each actually costs

```text
full history   everything, every turn, at 1x         lossless, quadratic
sliding window last N messages at 1x                 FLAT, and it FORGETS
prefix caching stable prefix at 0.1x, new msg at 1x  lossless, grows slowly
```

**A window is not compression — it is forgetting**, and the user is not told. A fact
established in turn 2 is gone by turn 30 and the model proceeds confidently without
it. Cost numbers for a window are therefore not comparable to the other two.

### The finding that contradicted my prior

I assumed the window would be cheapest — cheaper and worse, the classic tradeoff —
and wrote it as a test. It failed:

```text
20 turns:  cached $0.3271   vs   window-6 $0.3387
           forgets nothing        drops 289 turn-sends
```

**At this scale the cheaper option is also the lossless one. There was no tradeoff to
make.** The error was reasoning about tokens *sent* rather than tokens *billed*: six
turns at 1× costs more than twenty turns at 0.1×, and intuition counting messages
cannot see that.

### The ranking depends on length, and the crossover is computable

A cached prefix *grows*, so its read cost grows. A window is flat. So:

```text
caching cheaper    up to ~turn 25
window cheaper     beyond it
```

Record a decision like this **with its expiry condition** — "if `MAX_TURNS` is raised
past 25, re-measure" — or a future reader inherits the conclusion without the
condition that made it true.

Watch for more than one crossing. Taking the *first* turn where the window wins gives
turn 2 (caching has paid a write premium with nothing yet to read back) and justifies
the opposite decision. The number that matters is the **last** crossing.

### Where the cache breakpoint goes

Caching is a **prefix match**: any byte change before the breakpoint invalidates
everything after it.

```text
[ ...prior history... ][BREAKPOINT][ newest user message ]
                                     ↑ different every request
```

Put the newest message *inside* the cached prefix and it invalidates the cache on the
very request meant to read it — the feature then silently does nothing except add the
1.25× write premium. No error, no warning, a larger bill.

**A silently-never-hitting cache is the failure mode to watch for.** Check
`usage.cache_read_input_tokens > 0`; if it is always zero, something in the prefix is
changing.

Also silent: the **minimum cacheable prefix** is model-dependent (~1024–4096 tokens).
A short conversation is below it and will not cache at all.

### Context management is an input-side lever only

```text
input   71% of the bill at 20 turns   ← the only part any strategy here touches
output  29%, billed at 5x             ← untouched by trimming, caching or windowing
```

Worth knowing before optimising: if a workload is output-heavy, none of this helps and
the lever is `max_tokens`, terseness, or effort.

### Estimation is not measurement

Counting tokens honestly needs the provider's `count_tokens` endpoint. A
chars/4 heuristic is fine for **projection and display** and must never reach the
ledger — billing uses the `usage` the API returns.

**An estimate that leaks into an invoice is a lie with a decimal point.**

### Agent loops have the same curve, on a shorter axis

An agent re-sends its working history on every iteration, so one user question pays
for the accumulated tool results N times. The difference from a conversation: **the
bulk is TOOL RESULTS**, and a stale search result is mostly ballast — which opens an
option a conversation does not have. Throw it away.

```text
         strategy   input  cacheRead  cacheWrite     cost
             full   13200          0           0   $0.0660
           cached      50       8850        4300   $0.0316
           pruned    5320          0           0   $0.0266
    pruned+cached      50        922        4348   $0.0279
```

**You cannot simply DROP a stale tool result.** Every `tool_use` must have a matching
`tool_result` with the same id — remove one and the request is *malformed, not
cheaper*. Replace the content with a placeholder and keep the block.

### Optimisations are not additive

`pruned+cached` is worse than `pruned` alone, and the read/write split says why:

```text
cached          8850 read   4300 written    ← healthy reuse
pruned+cached    922 read   4348 written    ← reuse collapsed ~90%
```

**Caching needs an APPEND-ONLY history.** It is a prefix match, so a stable prefix is
the precondition. Pruning's whole job is to *edit* the prefix — so it destroys the
condition caching depends on, while the 1.25x write premium is still paid in full.

```text
conversation (appends)     → cache it
agent loop (edits/prunes)  → prune it, and do NOT also cache it
```

Two opposite conclusions, both correct, because the histories have different shapes.
**Before combining two optimisations, ask whether the first breaks the precondition of
the second.**

### A model that cannot represent the mechanism still produces plausible numbers

My first cost model summed a total per step and applied a cache discount to it. A
total cannot express *where* two requests begin to differ — and "where" is the entire
mechanic of prefix caching. It produced roughly-right numbers while being structurally
incapable of showing the interaction above.

The fix was to model each request as an ordered list of **segments** and find the
first index where the current request diverges from the previous one — which is what a
prefix cache actually does. The interaction then emerged from the model instead of
having to be asserted.

**Plausible numbers are the hardest kind of wrong to notice.** If a model cannot
represent the phenomenon, agreeing with it proves nothing.

### The value of an instrument is that it can contradict you

The measurement above existed only because Experiment 017 made cost readable. It then
immediately disproved the thing I was confident enough to write as a test. An
instrument that only ever confirms you is not being read.

---

# 39. Verification Debt

Built in Experiment 020. The companion to section 33 (Evaluation): that one asks *is
it good*, this one asks *has any of this ever actually run*.

### "Blocked" and "unbuilt" are different states

A project that cannot call a paid API accumulates claims it believes and has never
observed. ForgeAI reached **seven experiments** ending in the same sentence before
noticing the list had stopped being a footnote.

The important realisation: **most of a blocked claim is not the API call.** It is
knowing what evidence would settle the question, and that part is buildable today.

```text
EVIDENCE    what a live call produces         needs a credential
EVALUATOR   whether that evidence settles it  PURE — testable against fixtures NOW
```

Split them and the part with reasoning in it — the part that can be *wrong* — is
verified immediately. A credential then only supplies the input. Without the split,
"run it when you get a key" means shipping N untested judgements and finding their
bugs at the same moment as the answers.

### Three verdicts, not two

```text
pass      the evidence settles it affirmatively
fail      the evidence shows the predicted regression
unusable  malformed or missing evidence
```

`unusable` is not `fail`. Collapsing them manufactures findings out of broken fetches.
And **an evaluator must never throw** — a harness that crashes on a surprising
response has told you nothing.

### An evaluator that cannot fail is not an evaluator

Easy to write by accident. Test each one against a fixture of the *specific regression
its experiment predicted*, not just a happy path. For a cache claim that means
evidence of tokens written and none read — the silent failure, which by definition
looks fine everywhere else.

### Make the claim data, not a script

Id, the experiment it settles, the question *as that experiment recorded it*, the
evidence required, the evaluator. Then the blocked list can be **generated** instead of
maintained by hand — and a hand-maintained status list drifts. ForgeAI's README once
declared "Experiment 001, UI not started" directly above a table showing 001–012
complete.

### Declare coverage where the reader forms the expectation

A harness covering 5 of 9 claims must say so **before** the run, not in a summary line
at the end of a path nobody can currently execute. Otherwise the honest inventory is
itself dishonest — it promises nine answers and buys five.

The general rule: **state a limitation where the expectation is formed, not where the
code discovers it.**

### A probe that can fail for the wrong reason is worse than no probe

ForgeAI's cache probe pads its prefix past the minimum cacheable size. Below that
threshold the API silently does not cache, the claim would render `fail`, and the
conclusion would be wrong — the mechanism fine, the probe broken.

Before trusting a red result, ask what else could produce it.

### A test that mirrors the implementation tests nothing

ForgeAI's stream test opened with *"The algorithm lives in chat.tsx and ask.tsx; this
mirrors it."* Three copies of a boundary-sensitive reader, and a test covering none of
them — it could pass while both clients carried the exact bug it was written to catch.

**If a test reimplements the thing it tests, it verifies the copy.** Extract the
algorithm and point everything at it, including the test.

### End-to-end coverage answers a different question

Unit tests prove the pieces are right. Nothing proves they fit together: that a cookie
issued by one route is accepted by another, that a 404 is byte-identical *over real
HTTP*, that no secret reached the log — which is a stronger claim than "the redaction
function works", because it says nothing tried.

### A harness must clean up after itself

`next dev` spawns a separate `next-server` process. Killing the direct child orphans
the grandchild, which keeps the port. ForgeAI's e2e suite leaked one on every run
**while reporting success**, and the failure surfaced minutes later in a different
command, pointing at innocent code.

```text
spawn(..., { detached: true })      // child gets its own process group
process.kill(-child.pid, "SIGKILL") // kill the GROUP, not the process
```

`kill(pid)` is not "stop this program". And a leak is invisible to the thing that
caused it — which is why it reported success.

### Fault-tolerant gathering

A verification harness that aborts the whole run because one probe failed reports
nothing about the other eight. Wrap each probe; a failure means *not gathered*, which
is different again from *failed*.

That three-way distinction — pass / fail / unusable — earned itself the first time
ForgeAI ran the harness for real: an empty answer came back `unusable`, where
collapsing it into `fail` would have reported a regression that did not exist.

### A notebook that indexes itself becomes its own attack surface

ForgeAI retrieves from `experiments/*/README.md` on disk. Experiment 010's README
*documents* a prompt-injection attack — `</passage>`, `SYSTEM OVERRIDE: ignore all
previous instructions`, a forged `trusted="yes"`. So the corpus contains live payloads,
put there by writing about the problem honestly.

Measured on the live index: a query about passage escaping retrieved passages
containing real `</passage>` tags, and the renderer neutralised 5 of them with none
surviving into the prompt. **The defence is exercised by real data, not only by tests.**

The sharper consequence: **in a system that reads its own documentation, writing the
test down can break the test.** A canary phrase chosen because it is absent from the
corpus stops working the moment an experiment README quotes it — and nothing connects
the cause to the failure months later.

The only durable answer is a probe that **validates its own preconditions at run
time**:

```text
if (corpusContains(CANARY)) → report "unusable", not "failed"
```

A comment saying "don't quote this phrase" is exactly the kind of instruction that gets
lost.

### Retrieval indexes grow with the thing they index

```text
Experiment 008    65 chunks
Experiment 023   256 chunks · 8.6 minutes to build · ~850 MB · 93ms once warm
```

An in-process embedding model was the right call at 65 chunks and quietly stopped
being comfortable at 256 — rebuilt from scratch on every restart, with the request
simply *waiting* because the promise is cached and nothing reports progress.

Things to decide before the corpus is large, not after:

```text
persist the index        embeddings are float arrays; any store will hold them
cache by content hash    most restarts change nothing — re-embed only what moved
batch the embedding      one call over hundreds of long texts is where memory goes
report readiness         a request that waits minutes in silence is a bug
```

**A cold-start cost that scales with your documentation is a cost that only appears
once the project is going well.**

### Embeddings are deterministic, therefore cacheable

The same text through the same model always gives the same vector. Measured in
ForgeAI:

```text
cold  284 chunks, 0 cached     66.9 s - 196.8 s   (the spread is machine load)
warm  284 chunks, 284 cached    0.036 s
```

Three to four orders of magnitude, reproduced across runs.

Key it on a **hash of the text**, not a file path or chunk index — a section that moves
between documents, or shifts down as text is inserted above it, is the same text.
Editing one paragraph should cost one embedding, not the whole corpus.

Include the **model** in the key. Vectors from different models are not comparable, and
mixing them yields meaningless similarities rather than an error.

Store the raw float32 bytes. ForgeAI's cached vectors are bit-identical to fresh ones
(max component delta `0.00e+0`) because the model emits float32 and the BLOB holds
float32 — JSON would be ~8x larger and lossy in the last bits.

A content-addressed cache is also **portable**: valid in any database, because the key
describes the content rather than its location.

### Batch size matters enormously: a batch is padded to its longest member

Embedding every chunk in one call pads each short chunk to the length of the longest
text in the corpus, and the model does that wasted work for all of them.

Measured in ForgeAI, 285 chunks, interleaved A/B/A/B with each arm run twice:

```text
unbatched   1,061 s   /   996 s        (~17 minutes)
batched 16     56 s   /    58 s
                                       ~18x, and peak RSS 833MB -> 424MB
```

**And the unbatched path scales worse than linearly.** At 256 chunks it took 517 s; at
285 it took ~1028 s — **11% more chunks, 99% more time** — because cost is roughly
*n x longest chunk* and adding documents grows both factors.

Batch size is not a tuning detail on a padded-batch model. It is the difference between
a corpus that scales and one that does not.

### A measurement taken under uncontrolled conditions is a guess with a decimal point

Before running that A/B, ForgeAI recorded "batching cut the cold build 2.6x, 516.6 s →
196.8 s". Later runs of **the same batched code** came in at 162 s, 83 s, 71 s and 67 s.

```text
batched, same code:   66.9 s ... 196.8 s     a 2.9x spread from load alone
claimed effect of the change:  2.6x
```

The spread within one arm was larger than the effect being claimed. Load average on
that laptop ranged from 6 to 324 while the editor re-indexed the files being edited,
and the unbatched baseline was measured once and never repeated.

**The real effect was ~18x.** So the bad measurement pointed the right way and was still
worthless: it would have said 2.6x just as readily if batching had done nothing.
**Being right for bad reasons is still being wrong.**

What made it stick was that **the number agreed with a correct mechanism.** The padding
argument is sound; the timings looked like confirmation; they were noise. A plausible
explanation makes a bad measurement much harder to doubt than an implausible one.

```text
interleave A/B/A/B            the control for load that drifts mid-run
repeat each arm               one sample per arm is not a comparison
record the conditions         load average, what else was running
make the config switchable    so both paths can be re-run later
distrust an effect smaller than the spread within its own arm
```

That last rule catches this case with no extra runs at all.

### Prove the fast version is not the worse version

A speedup in retrieval is worthless if it quietly changes what is retrieved. Two checks,
both cheap:

```text
fidelity   cached vector vs freshly computed, same text, real model
quality    re-run the retrieval benchmark and compare to the recorded numbers
```

### 503 is the honest answer to "not ready"

A request that blocks for minutes is indistinguishable from a hang — especially when
the work is behind a cached promise, so later callers queue silently behind the first.
Return **503 + `Retry-After`** and start the work in the background. It has to be
decided before the first byte; past that the status is committed.

### A test suite can be rate-limited by the system it tests

ForgeAI's e2e suite went from 32/32 to 30/32 between two runs thirty seconds apart:

```text
logout succeeds                  got 429, want 200
the same cookie is now refused   got 429, want 401
```

Three different users all arrived with no `x-forwarded-for`, so the per-IP limiter
bucketed them as one caller sharing 20 tokens. Whether the suite exhausted the bucket
depended on how warm the caches were — the definition of flaky.

The fix was **not** to relax the limiter. They are genuinely different callers;
presenting them as one address was the unrealistic part.

**A flaky gate is worse than no gate**: it teaches people to re-run until green, which
is how a real failure gets ignored.

### A readiness probe must identify the server, not just the port

The same suite then failed with `register alice failed` — pointing at registration,
which was fine. A previous run's server was still holding the fixed port, the new one
could not bind, and the client talked to the **old** server, whose `APP_SECRET`
differed.

```text
check the port is FREE before spawning   → fail loudly instead of misdirecting
use a random port per run                → collisions become impossible
check child.exitCode while polling       → report the real error at once
```

That last one is worth doing everywhere: polling a dead child until a 60-second
timeout throws away the actual failure, which was in the captured output from the
start.

**Both flakes produced error messages naming innocent code** — a 429 blamed logout, a
401 blamed registration. When a test fails at a boundary, suspect the harness before
the feature.

### A local gate can be green for reasons CI does not share

ForgeAI's CI workflow ran three times and **failed three times** before anyone looked,
while every local run was green. The cause:

```text
Cannot find name 'LayoutProps'.
```

Next 16 generates global types (`LayoutProps`, `PageProps`) into `.next/` and
`next-env.d.ts` during `next dev`, `next build` or `next typegen` — **both git-ignored.**
Every developer machine had them; a fresh checkout did not. The local gate was only
green because of generated files lying around.

**Reproduce CI with a fresh clone before trusting a green local run:**

```text
git clone . /tmp/ci && cd /tmp/ci && pnpm install && <the CI steps, in CI's order>
```

Order matters: running the gate without CI's earlier `warm` step produced a different
set of failures — which turned out to be a real bug of their own, but not CI's.

And put the fix **in the gate**, not only in the workflow. Otherwise local and CI
disagree again.

### `promise ??= load()` caches a failure forever

A standard way to share one expensive load between concurrent callers:

```ts
modelPromise ??= loadModel();
```

`??=` assigns only when the value is null. **A rejected promise is not null**, so a
failed load is cached permanently:

```text
call 1 -> FAILED: network dropped
call 2 -> FAILED: network dropped      same stale error
load() was attempted 1 time           it would have succeeded on the second
```

In ForgeAI, a model download cut off after 79 seconds would have left search, ask and
agent broken until the process restarted. The pattern had been copied into three
modules, each with a comment correctly explaining why it cached the *promise* — which
made the missing failure case harder to see, not easier.

```ts
pending ??= load().catch((error) => { pending = null; throw error; });
```

Concurrent callers still share one attempt; the next caller after a failure starts a
fresh one.

**A comment that explains one property well can hide the property it does not
mention.**

### A gate nobody reads has not run, as far as anyone can tell

CI existed, ran, and failed — and nothing in the local workflow surfaced it. "CI
exists" and "CI is green" look identical from a terminal. A result has to reach the
person who can act on it: a badge, a notification, a command that reads it.

### Verification is not a gate unless something runs it

A verified claim can silently regress. A command someone has to remember is better
than nothing and is not the same as CI.

ForgeAI reached **six** verification commands before anything ran them, and the
failure mode was not hypothetical — a comment claiming a rate limit that did not
exist (012), a README contradicting its own table for twelve experiments (013), and
an e2e suite leaking a server process while reporting success (021).

**Build a gate, not a checklist.**

```text
order by cost, stop at the first failure
  types → lint → unit → end-to-end → benchmark
a type error should not wait behind a 16-second e2e run
```

Three places, because each has a different hole:

```text
local command   can be forgotten
pre-push hook   can be bypassed (--no-verify), and is absent on a fresh clone
                (core.hooksPath is local config, not a tracked file)
CI              cannot be skipped — the only one not depending on a person
```

CI should run **the same command** a developer runs. If the two can disagree, the
local one stops being trusted.

**Pre-push, not pre-commit.** A commit is a local checkpoint; blocking it punishes
work-in-progress. A push is the first moment the work becomes someone else's problem.

**Skipped is not passed.** A gate that costs money stays opt-in and says `skipped`
out loud — a gate that silently spends is a gate people disable.

**Print the failing gate's own output.** A runner that swallows its children's output
makes a failure harder to fix than no gate at all.

### Runtime-downloaded files are not in the package cache

A dependency that downloads a model on first use writes it *inside* `node_modules`.
The CI package cache (`cache: pnpm`, `cache: npm`) stores the package **tarball**, not
files the package wrote after install — so it silently re-downloads every run. Cache
that path explicitly, and verify the glob against the real tree rather than assuming
it resolves.

### Check how output looks to its actual consumer

In-place terminal progress (`\r`, `\x1b[K`) renders as literal `[K` when piped — and a
git hook's output and a CI log are both pipes. ForgeAI's gate was built for exactly
those two contexts and rendered worst in both. Guard on `process.stdout.isTTY`.

The general lesson, and the second time this project learned it: **look at the output
the way its reader will, not the way its author does while running it by hand.**

---

# 40. The ForgeAI Learning Path

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

# 41. My Engineering Philosophy

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

# 42. Personal Career Direction

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

# 43. Rule for Learning New Technologies

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

# 44. Current ForgeAI Status

**Last updated: 2026-09-16, after Experiment 026.**

Experiments 001–026 are built, documented and tested. One command, `pnpm check`, runs
every gate in ~38s, and a pre-push hook plus CI run it automatically. `pnpm test` runs 561 assertions
across 24 files; `pnpm e2e` runs 32 end-to-end assertions against a real server. `npx tsc --noEmit` and `pnpm lint` are clean.

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

src/lib/        31 modules — see README for the trust annotations
tests/          646 assertions, no framework
scripts/        pnpm eval · cost · verify · e2e · check (022, the gate)
.data/forge.db  SQLite — users, transcripts, sessions, usage ledger  (015-017)
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

# 45. Current Architecture

```text
Browser  ·  chat.tsx / ask.tsx / login.tsx      ← untrusted: the user controls this
   │
   │  POST  { messages[], persona }   ·   cookie: forge_session
   │  ←     NDJSON stream
   ▼ ──────────────────────────────────────────  trust boundary
Route Handler  ·  app/api/*/route.ts            ← trusted: the user cannot edit this
   │
   ├─→ guard.ts       identity · session check · rate limit · daily budget
   │                    └─ returns WHO, not just allowed/denied      (016)
   ├─→ transcripts.ts readable(id, userId) — 404, never 403          (016)
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

# 46. What Is Verified, and What Is Not

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
A forged assistant turn is no longer expressible (015)
A logged-out token is refused though its signature is valid (015)
A conversation survives the server process being killed (015)
A stranger asking for your conversation gets the same 404 as for a fake id (016)
A denied request leaves the target transcript unchanged (016)
Login reveals nothing about which usernames exist, in message or timing (016)
A budget in dollars refuses paid work and still allows free routes (017)
Integer nanodollars sum exactly where floats drift by 1.4e-14 (017)
History growth is quadratic: 4x the input per doubling of turns (018)
Prefix caching is 53% cheaper than full history at 20 turns, losslessly (018)
Pruning + caching is WORSE than pruning alone: reuse collapses 8850 → 922 (019)
All 9 blocked claims have fixture-tested evaluators; only evidence is missing (020)
32 end-to-end assertions pass against a real server, no credential needed (021)
The full gate runs in ~38s; breaking a test on purpose stops it at that gate (022)
The corpus really contains injection payloads; the renderer neutralised 5 (023)
The notebook index is 256 chunks and takes 8.6 minutes to build (023)
Caching embeddings: tens of seconds cold → 36-71ms warm, reproduced (024)
CI failed 3/3 runs on a type generated only by `next dev` — green locally, never in CI (026)
A cached rejected promise would have kept search broken until restart (026)
Batching: ~18x faster and half the RSS — after a first attempt measured 2.6x
  from noise, inside a 2.9x spread of its own arm (024/025)
Cached vectors are bit-identical to fresh ones, and retrieval is unchanged (024)
pnpm test 561/561 · pnpm e2e 32/32
```

**Established engineering knowledge — true in general, relied on here:**

```text
The browser cannot hold a secret; anything it can send, the user can read
The Messages API is stateless; the messages array IS the conversation
A signed token is not an encrypted one — the holder may read, not alter
The HTTP status is committed with the first byte, so a stream cannot 502 late
An average hides the tail; a log that captures a secret has moved that secret
A 4xx is the client being wrong, not the server failing
A signature proves authenticity, never that a token is still wanted
Unguessable is not owned: authentication is not authorization
A password needs a SLOW hash; a token needs a fast one. Opposite problems.
Money is an integer, in a unit smaller than the smallest rate you multiply by
Output tokens cost 5x input; a cache write only pays off on the second read
Caching is a prefix match — volatile content must fall AFTER the breakpoint
Caching needs an append-only history; editing the prefix destroys it
A tool_result block cannot be dropped — only its content replaced
"Blocked" and "unbuilt" are different states — most of a blocked claim is buildable
State a limitation where the expectation is formed, not where the code finds it
A test that reimplements what it tests verifies the copy, not the code
kill(pid) is not "stop this program" — kill the process group
Anything an attacker can measure is an output — timing and error choice included
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
A real cache hit — a cache that never hits costs 1.25x and looks fine (018)
What keepRecent=3 costs in answer quality when passages must be cited (019)
A ledger row written from a LIVE usage object — the arithmetic, schema,
aggregation and enforcement are all verified; only the join to a real
response is not (017)
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
