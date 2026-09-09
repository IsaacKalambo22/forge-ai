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

## Engineering principle

Understand each layer before introducing abstraction.
