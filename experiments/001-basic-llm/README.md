# Experiment 001 — Basic LLM Request

## Objective

Understand the basic interaction between an application and a Large Language Model.

## Questions

1. How does my application send a request to an LLM?
2. What is a system instruction?
3. What is a user message?
4. What is context?
5. What does the model return?
6. What are tokens?
7. What is the context window?
8. What affects latency?
9. What affects cost?
10. What can cause an incorrect answer?

## Experiment

Send a simple request to an LLM and inspect the response.

## Observations

### Request flow verified

```text
Browser → POST /api/chat → route.ts → askClaude() → Anthropic SDK → Claude
```

`src/app/api/chat/route.ts` exists, typechecks clean, and was exercised with `curl`
before any UI was written. Testing the endpoint directly separates backend/LLM
problems from React/UI problems — worth doing in that order every time.

### Validation behaves as intended

| Body sent | Valid JSON? | Response |
| --- | --- | --- |
| `{"message":""}` | yes | 400 `Message is required` |
| `{"message":"   "}` | yes | 400 `Message is required` |
| `{}` | yes | 400 `Message is required` |
| `{"message":42}` | yes | 400 `Message is required` |
| `"just a string"` | yes | 400 `Message is required` |

Checking `typeof message !== "string" || message.trim() === ""` covers missing,
wrong-type, empty and whitespace-only input in one guard. It also correctly handles
a bare JSON string body, which was not anticipated: `"just a string".message` is
`undefined` in JavaScript rather than an error, so the type check catches it.

A `GET` to the same URL returns **405** without any code being written for it —
Next.js derives the allowed methods from which functions the file exports.

### Finding: validation only protects the lines beneath it

Malformed JSON and a literal `null` body both produce **HTTP 500 with an empty
response body**:

| Body sent | Valid JSON? | Response | Where it failed |
| --- | --- | --- | --- |
| `{"message":` | no | 500, empty | `await request.json()` |
| `hello` | no | 500, empty | `await request.json()` |
| *(empty body)* | no | 500, empty | `await request.json()` |
| `null` | **yes** | 500, empty | `const message = body.message` |

Two distinct failure classes, separated by *where in the file* execution dies.
Anything reaching the `if` on line 7 returns a clean 400; anything failing on line 4
or 5 throws before the guard exists.

The `null` case is the notable one: it is syntactically valid JSON, so parsing
succeeds, but reading a property off `null` throws `TypeError`. **A request can send
valid JSON and bypass validation entirely.** It fails closed — no model call, no cost —
but the hole is real. Deferred to a later experiment, since Experiment 001
deliberately adds no error handling.

### Finding: unhandled errors return an empty body by design

Every 500 above returned **zero bytes**, no error message and no stack trace. The
`SyntaxError` / `TypeError` appears only in the server terminal. This is Next.js
refusing to leak server internals to a client — useful in production, confusing in
development until you know to read the terminal instead of the response.

Practical consequence: piping `curl` to `python3 -m json.tool` produces the misleading
`Expecting value: line 1 column 1 (char 0)`, which is Python complaining about an
empty input, not about the app. Always print the status code:

```bash
curl -s -w '\nHTTP %{http_code}\n' ...
```

### Finding: failing early is ~50× cheaper than failing at the provider

| Failure | Application-code time |
| --- | --- |
| JSON parse error | 9–17 ms |
| Validation rejection | ~9 ms |
| Auth rejection from Anthropic | **741 ms** |

The gap is the network round trip. A 400 costs nothing and never leaves the machine;
reaching Anthropic costs most of a second even when the request is rejected. This is
the concrete argument for validating before calling out.

### The API key is a separate credential

A Claude / Claude Code **subscription is not an API credential**. They are separate
access and billing mechanisms. With the placeholder key, the request genuinely leaves
the machine and Anthropic replies `401 invalid x-api-key` (confirmed by the
`request_id` and Cloudflare headers in the server log) — so the SDK wiring, routing and
JSON handling are all proven correct. Only the credential is missing.

## Lessons

1. **SDK** — a library giving our code a convenient interface for talking to a service.
2. **LLM** — the model that processes input and generates output.
3. **Route Handler** — server-side code that receives an HTTP request and returns an
   HTTP response. In the App Router it must be named `route.ts`, and the *exported
   function name* (`POST`) is what defines the routing.
4. The browser must **not** call Anthropic directly. To reach the API a request needs
   an `x-api-key` header, and anything the browser can send, the user can read from
   DevTools. The browser must hold the plaintext key in order to send it, so the key
   is always recoverable — a property of the execution model, not a fixable bug.
5. The API key belongs on the **server**. `ANTHROPIC_API_KEY` is deliberately *not*
   prefixed `NEXT_PUBLIC_`; that prefix is an opt-in to being inlined into the browser
   bundle.
6. The trust boundary is not only about hiding a string. It is the only place control
   logic can live, because it is the only code the user cannot edit — the system
   prompt, model choice, `max_tokens` and rate limits all depend on it.
7. The route validates that `message` is a non-empty string before spending anything.
8. `ai.ts` returns the **raw Anthropic response** so `content`, `usage`, `stop_reason`
   and `model` can be inspected.
9. `content` is an **array of blocks**, not a string — the shape is built for thinking
   blocks and tool-use blocks, which this version deliberately excludes.
10. Validation protects only the code that runs *after* it.
11. Understand the architecture before introducing abstractions.

## Questions I still don't understand

Answered so far by this experiment: **Q1** (how the request is sent) and, partially,
**Q8** (latency — the network round trip dominates everything local).

Still open, blocked on a real API key:

- **Q5** — what the model returns: needs a successful call to read `content`,
  `usage`, `stop_reason` and `model` from a real response.
- **Q6** — tokens: needs `usage.input_tokens` / `usage.output_tokens` on real input.
- **Q7** — the context window: needs a response, and a prompt long enough to see
  `stop_reason` flip from `end_turn` to `max_tokens` against the 1024 ceiling.
- **Q9** — cost: follows directly from Q6.

Not yet touched, because `askClaude()` sends no system prompt and keeps no history:

- **Q2** — system instruction
- **Q3** — user message (sent, but not yet contrasted with anything else)
- **Q4** — context
- **Q10** — what causes an incorrect answer

*To be completed once a key is available.*
