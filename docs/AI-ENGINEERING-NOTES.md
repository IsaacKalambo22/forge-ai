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

An AI system can appear to work while producing unreliable results.

Therefore we need **evaluation**.

Instead of:

> "This answer looks good."

we create tests such as:

```text
Question
Expected behavior
Actual answer
Score
```

For example:

```text
Question:
What is the company's leave entitlement?

Expected:
32 days

Model:
32 days

Result:
PASS
```

This allows AI systems to be tested systematically.

---

# 34. The ForgeAI Learning Path

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

# 35. My Engineering Philosophy

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

# 36. Personal Career Direction

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

# 37. Rule for Learning New Technologies

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

# 38. Current ForgeAI Status

Current project:

```text
forge-ai/
```

Stack:

```text
Next.js
React
TypeScript
Tailwind CSS
Anthropic SDK
```

Current important files:

```text
src/app/page.tsx
src/lib/ai.ts
package.json
```

The Anthropic SDK is already installed.

`src/lib/ai.ts` already contains an Anthropic client and an `askClaude()` function.

However, the default `page.tsx` is still the Next.js starter page.

Therefore the AI functionality has **not yet been connected to the user interface**.

---

# 39. Current Architecture

At this stage:

```text
                 ┌──────────────────┐
                 │     Browser      │
                 │                  │
                 │  page.tsx        │
                 └────────┬─────────┘
                          │
                          │
                          X
                    Not connected
                          │
                          │
                 ┌────────▼─────────┐
                 │      ai.ts       │
                 │                  │
                 │  askClaude()     │
                 └────────┬─────────┘
                          │
                          ▼
                 Anthropic SDK
                          │
                          ▼
                  Anthropic API
                          │
                          ▼
                       Claude
```

The next engineering task is to connect these pieces safely.

---

# 40. Next Step

Experiment 001 will establish the first complete pipeline:

```text
User enters question
        ↓
Browser
        ↓
POST /api/chat
        ↓
Next.js Route Handler
        ↓
askClaude()
        ↓
Anthropic SDK
        ↓
Anthropic API
        ↓
LLM
        ↓
Response
        ↓
Browser
```

We will also expose useful measurements such as:

```text
Input tokens
Output tokens
Latency
```

The purpose is to understand the pipeline, not merely to create a chatbot.

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
