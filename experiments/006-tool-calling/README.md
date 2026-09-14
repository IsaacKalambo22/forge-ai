# Experiment 006 — Tool Calling

## Objective

Let the model call our code, and build the loop that makes that work.

## Questions

1. What is the actual mechanic — how does a model "call" a function?
2. Who runs the tool, and with whose privileges?
3. How trustworthy are the arguments?
4. What stops the loop?

## Implementation

The mechanic is a **loop**, not a callback. The model cannot execute anything; it can
only *ask*, by ending its turn with `stop_reason: "tool_use"` instead of `end_turn`.

```text
send messages + tool definitions
        ↓
stop_reason: "tool_use"?  ── no ──→  done
        ↓ yes
append the assistant turn VERBATIM (tool_use blocks and all)
run the tool
append ALL results in ONE user message
        ↓
        └──→ back to the top
```

Written by hand in `runToolLoop()` rather than using the SDK's `toolRunner()`, because
this repo's stated principle is *"understand each layer before introducing abstraction"*
and the loop is the layer. `toolRunner()` is the right production choice and would
delete most of this code — *deferred, on purpose*.

It is an **async generator**, so the route forwards events straight to the NDJSON stream
from Experiment 004 without buffering a whole run. Two new event types make the loop
visible in the UI:

```text
{"type":"tool_use","name":"calculate","input":{"expression":"17*3"}}
{"type":"tool_result","name":"calculate","output":"51","is_error":false}
```

Two tools, chosen because each fixes a real model weakness:

| tool | why |
| --- | --- |
| `get_current_time` | the model has no clock |
| `calculate` | the model does arithmetic by prediction, not computation |

## Observations

### The arguments are untrusted input that took a detour

This is the finding that reframes everything. A tool runs **on the server, with the
server's privileges** — the same process that holds `ANTHROPIC_API_KEY`. Its arguments
are written by the model, and the model is influenced by whatever the user typed.

So the chain is: *user text → model → tool arguments → our code runs them.* The user does
not control the arguments directly, which is exactly what makes this easy to miss. They
are not attacker-controlled; they are attacker-**influenced**, which is close enough that
the code must treat them as hostile.

The obvious implementation of `calculate` is one line:

```ts
return String(eval(expression));   // never do this
```

Measured, with a fake secret in the environment:

| `eval(...)` | returned |
| --- | --- |
| `"2+2"` | `4` |
| `"process.env.DEMO_SECRET.length"` | `24` |
| `"Object.keys(process.env).length"` | `54` |
| `"process.pid"` | `36385` |

`eval` read the secret's length — which means it had the value — and enumerated all 54
environment variables. `ANTHROPIC_API_KEY` is one of them. Every defence from Experiments
001–005 (the trust boundary, `server-only`, the persona allowlist) would still be
perfectly intact, and completely bypassed, because we handed the attacker an interpreter.

The implementation is a ~110-line recursive-descent parser instead. **It cannot express
anything but arithmetic**, so there is no payload to smuggle — the safety is structural,
not a blocklist that has to anticipate attacks.

### Verified: 28/28 evaluator cases

The evaluator is pure logic with no imports, so it is directly testable:

```text
Arithmetic:
  2+2 = 4 · 17*3+1.5 = 52.5 · 2+3*4 = 14 (precedence) · (2+3)*4 = 20
  10/4 = 2.5 · 10%3 = 1 · -5+3 = -2 · -(2+3) = -5 · --3 = 3 · 2*-3 = -6
  ((((1)))) = 1 · 0.1+0.2 = 0.30000000000000004

Must be rejected:
  1/0 · 1%0 · "2 +" · "(2 + 3" · "2 + 3)" · "1 2" · ""
  process.exit(1) · require('fs') · 1; console.log('pwned') · globalThis
  process.env.ANTHROPIC_API_KEY · __proto__ · 1e400 · alert(1)

28 passed, 0 failed
```

Every payload that `eval` executed above is rejected at the first unexpected character.
Note `"1 2"` and `"2 + 3)"`: **trailing input is an error, not something to ignore.**
Silently parsing the prefix is how `"1; rm -rf /"` quietly becomes `1`.

### Design pressure: `server-only` blocks unit testing

`tools.ts` is marked `server-only` (Experiment 002), which means a plain Node test cannot
import it — the marker exists precisely to make that import fail.

That tension is real, and it produced a better structure rather than a workaround. The
pure arithmetic moved into `src/lib/expression.ts`, which has **no imports at all**:

```text
expression.ts   pure function, no privileges       → testable anywhere
tools.ts        execution, dispatch, "server-only" → runs only on the server
```

The dangerous part of a tool is its *execution context*, not its logic. Separating them
means the logic can be tested exhaustively and the context stays locked down.

**Not tested in isolation:** `executeTool()` itself — its type-check on `expression`, the
200-character cap, the unknown-tool branch, the catch. `server-only` prevents importing it
into a Node script, and no successful model call has exercised it. Its *inputs* are
covered by the 28 cases above; its own branching is not.

### The loop needs a ceiling that is ours, not the model's

`MAX_TOOL_ITERATIONS = 5`. Each iteration is a **paid API request**, and the model decides
whether there is another one. Without a cap, a model that keeps requesting tools bills us
indefinitely — a denial-of-service we perform on ourselves. This is Experiment 003's
lesson again (whoever holds the loop holds the bill), one level further up.

Two smaller rules, both easy to get wrong:

- **The assistant turn is appended verbatim, including the `tool_use` blocks.** Their `id`
  is what results are matched against. Extracting just the text breaks the pairing.
- **All results go back in ONE user message.** Splitting them across several messages
  teaches the model to stop making parallel tool calls.

And a failed tool is reported with `is_error: true`, never dropped. The model needs to see
the failure to correct itself — which is why `executeTool` returns unknown-tool and
bad-argument cases as results rather than throwing and killing the conversation.

### Verified: routes and bundle unchanged

| Check | Result |
| --- | --- |
| `POST /api/chat` | 200, NDJSON, `{"type":"error", …401…}` on the first iteration |
| validation (empty · `role:"system"` · unknown persona · trailing assistant) | 400 each |
| `POST /api/analyze` | 502 — unaffected |
| `get_current_time`, `Unexpected character`, `lib/tools.ts`, `lib/expression.ts`, `x-api-key` in browser | **0 hits each** |
| bundle | 14 chunks, 3,755,254 bytes (+2,577 = the activity UI) |

### Not verified

**The loop has never completed an iteration.** The 401 lands on the first request, so:
no `stop_reason: "tool_use"` has ever been observed, no tool has been invoked by a model,
no result has been fed back, and the `MAX_TOOL_ITERATIONS` ceiling has never been reached.
The loop's *structure* comes from the SDK reference; its *behaviour* is unobserved.

What is verified is everything that does not require the model: the evaluator (28 cases),
the routes, the stream format, the bundle.

## Lessons

1. **Tool calling** — the model cannot execute anything. It ends its turn asking, and
   your code decides whether and how to comply.
2. `stop_reason: "tool_use"` is the signal. `end_turn` means it is finished.
3. It is a loop, not a callback: request → execute → append result → send again.
4. Tool arguments are user-influenced input arriving by an indirect route. Validate them
   exactly as you would a request body.
5. **Never `eval()` a tool argument.** Measured: it reads the environment, including the
   API key. A parser that can only express arithmetic has no payload to smuggle — make
   safety structural, not a blocklist.
6. Reject trailing input. Parsing a prefix and ignoring the rest is a vulnerability.
7. Cap the iterations. Each one is a paid request and the model chooses whether to
   continue.
8. Append the assistant's turn verbatim — `tool_use` ids are the pairing key.
9. Return all tool results in a single user message, or parallel tool use degrades.
10. Report tool failures with `is_error: true` rather than throwing. The model can recover
    from a reported error; it cannot recover from a dropped one.
11. Keep pure logic in modules with no privileges and no imports. It tests better, and it
    makes the privileged surface small enough to review.
12. Show the loop in the UI. An agent you cannot watch is one you cannot debug.

## Future questions

- Does the model actually call these tools, and does the description wording change how
  often? *(blocked — needs an API key)*
- `executeTool()`'s own branches are untested. *(blocked by `server-only`; a test runner
  that understands the Next module graph would fix it — deferred)*
- Human-in-the-loop approval: a tool that must be confirmed before it runs. Nothing here
  is destructive yet, so nothing needs a gate — that changes the moment a tool writes.
  *Deferred.*
- `toolRunner()` would replace `runToolLoop()` now that the mechanics are understood.
  *Deferred.*
- Prompt injection: user text that talks the model into calling a tool it should not.
  The defences here bound what a tool can *do*; nothing yet bounds what the model can be
  *persuaded* to request. *Deferred — and the reason tool permissions become their own
  experiment.*
