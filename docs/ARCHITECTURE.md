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
src/lib/personas.ts   ids only                     → either side may import
src/lib/ai.ts         prompt text, SDK, API key    → "server-only", build error if
                                                     imported from a Client Component
```

An import pulls in the whole module and its import graph — trust level is a property of
the *file*, not of the value you named. Split files by what may reach the browser.

## Engineering principle

Understand each layer before introducing abstraction.
