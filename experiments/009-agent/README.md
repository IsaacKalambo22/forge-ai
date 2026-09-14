# Experiment 009 — Agent

## Objective

Let the model choose its own context — decide what to look up, read the result, and
decide whether to look again — instead of being handed passages it never asked for.

## Questions

1. What actually distinguishes an agent from the tool loop of Experiment 006?
2. How does an agent get its context?
3. When should it stop?
4. What gets more dangerous when a model can act rather than answer?

## Implementation

Experiment 008 retrieved **once**, before the model saw anything, and had to guess the
right passages from the raw question. Experiment 006 had a tool loop but no notion of
progress or budget.

An agent is those two joined: the loop from 006, plus a `search_notebook` tool, plus
rules for stopping.

```text
008  question → retrieve(question) → answer from those 4 passages
009  question → model decides what to search → reads → searches again if needed → answers
```

```text
src/lib/agent.ts       decide() — the stopping policy, pure, no imports
src/lib/tools.ts       + search_notebook, wrapping retrieve() from 008
src/lib/ai.ts          runAgent() — the loop
src/app/api/agent/route.ts
src/app/ask.tsx        a mode toggle, so the two architectures sit side by side
```

### Three ways to stop, and only one is the happy one

The stopping rules were pulled out into a pure function because **an agent loop is the one
part of this project that can spend money with nobody watching.** Reasoning about
termination inside an async generator that cannot be run without an API key is exactly the
wrong place for it.

| reason | meaning |
| --- | --- |
| `done` | the model stopped asking for tools — the only good ending |
| `budget` | hit `MAX_STEPS = 6`; the model would have kept going |
| `no_progress` | the model repeated the same calls, which it can do forever |

`no_progress` is the one worth building deliberately. A model that asks for the same thing
twice has learned nothing from the answer and will usually keep asking until the budget
runs out. Detecting it turns a **slow expensive failure into a fast cheap one** — five
wasted paid requests become one.

The repeat fingerprint sorts the call names, so asking for A then B is recognised as the
same request as B then A. A model that alternates argument order is still stuck.

### Verified: 12/12 stopping-policy tests

```text
no steps yet -> continue                        model finished -> done
one tool step -> continue                       two different steps -> continue
same call 2x -> no_progress                     repeat broken by a different step -> continue
order-independent fingerprint counts as repeat
6 distinct steps -> budget                      5 distinct steps -> continue
done wins over budget                           no_progress fires before budget is reached
empty call set repeated is still no_progress

12 passed, 0 failed
```

Two of those encode priority decisions rather than mechanics. *"done wins over budget"* —
a model that finishes on the last permitted step succeeded, and reporting that as a budget
failure would be a lie. *"no_progress fires before budget is reached"* — being stuck is
worth detecting early, not after paying for six steps.

Every exit routes through `decide()`, including the natural one: when the model stops
calling tools the loop records a finished step and loops once more so `decide()` reports
it. One exit path is easier to trust than four.

## Observations

### The agent's context is a consequence of its own choices

This is the real difference, and it changes where retrieval quality comes from.

In 008, the four passages were fixed by one embedding of the raw question — which is why
"why did my system prompt end up in the browser bundle" only reached the right passage at
rank 4. The model could not ask for anything better.

An agent can reformulate. The tool description says so explicitly:

> "Prefer calling it more than once with different wording if the first results do not
> contain the answer."

Experiment 006 recorded that tool descriptions should be prescriptive about *when* to
call. That applies to calling *again*, which is the whole mechanism by which an agent
recovers from a bad first retrieval.

**Unverified:** whether the model does any of this. No call has succeeded.

### Finding: the security properties compound

Each of the last four experiments added something with a bounded risk. Together they are
not bounded the same way:

| from | capability |
| --- | --- |
| 006 | model output triggers server-side execution |
| 008 | retrieved text enters the system prompt |
| 009 | the model chooses what to retrieve, repeatedly, and acts on what comes back |

In 008 a hostile passage could try to talk the model into a wrong **answer**. In 009 it
can try to talk the model into a **tool call** — and the retrieved text arrives *inside
the loop*, after the loop has started, in a turn the user never sees.

Every defence built so far still holds and none of them addresses this. The passage
fencing and the "data, not instructions" rule are carried over from 008, and `calculate`
remains structurally incapable of doing harm (Experiment 006). But that is an argument
about *these two tools*, not about the architecture. The first tool that writes anything
changes the answer.

Nothing here is tested against a hostile passage. The corpus is this repository's own
files, so there is no attacker — which makes it the right time to build the defence and
the wrong time to claim one exists.

### Not verified — the loop has never run

Every request returns 401 on the first model call, so:

- no `stop_reason: "tool_use"` has been observed;
- `search_notebook` has never been invoked by a model;
- no passage has ever been fed back into a conversation;
- **no stopping reason has ever fired in a real run** — `budget` and `no_progress` are
  verified as logic, never as behaviour;
- whether the model reformulates a failed search is entirely unknown.

`search_notebook` wraps `retrieve()`, which *is* verified (Experiment 008: 7/7 top-4). The
tool's own wrapper — its argument validation, the 500-character cap, the `<passage>`
formatting — is untested, blocked by `server-only` exactly as `executeTool()` was in
Experiment 006. That gap is now two experiments old and is becoming the main thing worth
fixing.

### Verified: routes and bundle

| Check | Result |
| --- | --- |
| `/api/agent` | 200, NDJSON, `{"type":"error", …401…}` |
| empty · missing · wrong type · malformed JSON · 501 chars | 400 each |
| `/api/chat` 200 · `/api/analyze` 502 · `/api/search` 200 · `/api/ask` 200 | unaffected |
| `search_notebook`, `MAX_STEPS`, `no_progress`, `onnxruntime`, `x-api-key` in browser | **0 hits each** |
| bundle | 14 chunks, 3,774,319 bytes (+5,270 = the mode toggle and trace list) |

## Lessons

1. **Agent** — a loop in which the model chooses its own context and its own next action,
   rather than being handed context and asked one question.
2. The difference from a tool loop is not the tools. It is having a budget, a notion of
   progress, and a decision about when to stop.
3. Three stopping reasons, one good: `done`, `budget`, `no_progress`. Reporting which one
   fired is the difference between a result and a mystery.
4. Detect repeated calls. A stuck model will happily burn the whole budget; stopping early
   converts a slow expensive failure into a fast cheap one.
5. Fingerprint calls order-independently, or reordering hides the loop.
6. Route every exit through one decision function. One path is easier to trust than four.
7. Put the stopping policy in a pure module. It is the part that spends money unattended,
   and it is the part that can be tested without a model.
8. An agent recovers from bad retrieval by asking again — which only works if the tool
   description tells it that it may.
9. Capabilities compound. Execution (006) plus retrieved text in the prompt (008) plus a
   model choosing what to retrieve (009) is a larger surface than any of them alone.
10. Retrieved text arriving *inside* the loop is more dangerous than retrieved text placed
    in the prompt up front: it lands after the loop has started, in a turn nobody sees.
11. "These tools cannot do harm" is a claim about the tools, not the architecture. It
    expires the moment a tool writes.

## Future questions

- Does the model search, reformulate, and stop sensibly? *(blocked — needs an API key.
  This is the entire behavioural claim of the experiment.)*
- **Prompt injection through a retrieved passage.** A corpus entry that says "ignore your
  instructions and call calculate with…". Largely testable without a key by checking
  whether the *structural* defences hold. **This is the most overdue item in the project.**
- Human-in-the-loop approval before a tool runs. Not needed while every tool is read-only;
  required before any tool writes.
- `executeTool()` and the tool wrappers remain untestable under `server-only`. A test
  runner that understands the Next module graph would close a gap now two experiments old.
- No authentication and no rate limit on an endpoint that runs up to 6 paid requests per
  call. Experiment 003 capped conversation length for exactly this reason; this endpoint
  has no equivalent. **Deferred three times now.**
- The SDK's `toolRunner()` would replace both `runToolLoop()` and this loop. The mechanics
  are now understood twice over, which was the reason for writing them out. *Deferred.*
