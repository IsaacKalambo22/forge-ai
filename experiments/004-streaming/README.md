# Experiment 004 — Streaming

## Objective

Deliver the reply as it is generated instead of after it is finished, and find out what
that changes about error handling.

## Questions

1. What does the server send, and in what format?
2. How does the browser read a response that has not finished?
3. Where do `usage` and `stop_reason` live when there is no single response object?
4. What happens to error handling when the response has already started?

## Implementation

`messages.stream()` replaces `messages.create()`. It returns a stream object rather than
a promise — the request is still in flight when the function returns.

The route pipes its events into a `ReadableStream` and returns that as the response body.
The wire format is **NDJSON**: one complete JSON object per line.

```text
{"type":"text","text":"Hello"}
{"type":"text","text":", world"}
{"type":"done","usage":{...},"stop_reason":"end_turn","model":"claude-opus-5"}
```

NDJSON was chosen over **SSE** (Server-Sent Events, the format the Anthropic API itself
uses) because it carries no `data:` / `event:` framing to strip — the browser side is
`split("\n")` and `JSON.parse`. SSE is the standard for this job and brings automatic
reconnection via `EventSource`; adopting it is *deferred — revisit later*.

`StreamEvent` is a discriminated union in `src/lib/messages.ts`, so both sides `switch`
on `type` and TypeScript checks every branch.

## Observations

### Finding: once streaming starts, the status code is already gone

This is the finding of the experiment, and it is fully verified — no API key needed,
because the 401 that has blocked every experiment so far is itself the demonstration.

The same failure, before and after this change:

| | Experiment 003 | Experiment 004 |
| --- | --- | --- |
| Anthropic returns 401 | route returns **HTTP 502** | route returns **HTTP 200** |
| body | `{"error":"Model request failed: 401 …"}` | `{"type":"error","error":"Model request failed: 401 …"}` |

Verified response headers:

```text
HTTP/1.1 200 OK
content-type: application/x-ndjson; charset=utf-8
transfer-encoding: chunked
cache-control: no-store
{"type":"error","error":"Model request failed: 401 …invalid x-api-key…"}
```

**The HTTP status line is sent with the first byte.** By the time `streamClaude()` fails,
the response has already been constructed and the 200 has gone out. There is no way to
retract it. So a failure after streaming begins must be reported *inside the body*, as
data, and the client has to check for it explicitly.

This splits error handling into two régimes, and the split is exactly the line where
bytes start flowing:

```text
parse body, validate messages, validate persona   → real status codes (400)
────────────── first byte of the response ──────────────
model call, deltas, finalMessage()                → HTTP 200, errors as {type:"error"}
```

Validation still behaves exactly as in 003 — verified, all still 400:

| Case | Status |
| --- | --- |
| empty array · starts with assistant · ends with assistant | 400 |
| `role: "system"` · unknown persona · malformed JSON | 400 |

`transfer-encoding: chunked` is what makes this possible: no `Content-Length`, because
the length is not known when the headers are written.

### Finding: network chunks do not align with lines

A `reader.read()` does not hand you one event. It hands you whatever bytes arrived — half
a JSON object, or three and a half. The fix is to keep the tail in a buffer and only parse
up to the last complete newline:

```ts
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? "";   // the incomplete tail waits for more bytes
```

Tested against adversarial chunk sizes over a payload containing multi-byte UTF-8
(`—`, `ï`, `☕`), reassembling 4 events:

| chunk size | events parsed | text |
| --- | --- | --- |
| 1 B, 2 B, 3 B, 5 B, 7 B, 13 B, 32 B, 64 B, 999 B | 4 / 4 each | exact match |

**9 passed, 0 failed** — including 1-byte chunks, which split individual UTF-8
characters. `decoder.decode(value, { stream: true })` is what holds a partial codepoint
back until its remaining bytes arrive; without `{ stream: true }` those become `�`.

The negative control, parsing each chunk directly with no buffer:

| chunk size | parsed | `JSON.parse` failures |
| --- | --- | --- |
| 13 B | 0 | 19 |
| 64 B | 2 | 5 |

The 64-byte row is the dangerous one. It *partly works* — enough to look fine in a quick
manual test, and to break later when the network delivers different chunk sizes. A bug
that depends on packet boundaries is not one you find by clicking around.

*(These two tables come from a standalone Node script run against the exact algorithm in
`chat.tsx`, not from the live server — the live path still stops at 401.)*

### `usage` and `stop_reason` are not in the deltas

Text deltas carry text and nothing else. The totals only exist once the message is
complete, and the SDK's stream object assembles it for us:

```ts
const final = await stream.finalMessage();
```

That is where `usage.input_tokens`, `usage.output_tokens`, `stop_reason` and `model` come
from, and it is why the stream ends with a `done` event carrying them. The UI now renders
that line under each reply — which is the delivery mechanism for Experiment 001's
questions Q6 (tokens), Q7 (context window) and Q9 (cost). **Not yet observed**: no
successful call has happened, so no real `usage` numbers exist.

### A partial reply is not a conversation turn

`streaming` is held in its own state, separate from `messages`. Only a completed answer is
appended to the history. If a stream dies halfway, the half-sentence is discarded rather
than becoming a permanent forged-looking assistant turn that gets resent on every
subsequent request (Experiment 003).

## Lessons

1. **Streaming** — the response body is written incrementally while the model generates,
   rather than sent once complete.
2. The HTTP status is committed with the first byte. Any failure after that must be
   reported inside the body. A streaming endpoint returns 200 for errors it has no way to
   take back.
3. Therefore: do all validation *before* the first byte. Everything cheap to check belongs
   above the stream, where a real status code is still available.
4. `transfer-encoding: chunked` — the response has no `Content-Length` because the length
   is not known when the headers go out.
5. A read gives you bytes, not messages. Buffer the tail and parse only complete lines.
6. `TextDecoder` needs `{ stream: true }` to hold back partial multi-byte characters.
7. A bug that depends on chunk boundaries can pass a casual test and fail in production.
   Test the boundaries deliberately.
8. `usage` and `stop_reason` are not in the deltas; they come from `stream.finalMessage()`.
9. Keep in-flight output out of the conversation history until it completes.
10. **NDJSON** — newline-delimited JSON, one object per line. **SSE** — Server-Sent
    Events, the standard alternative, with framing and built-in reconnection.

## Future questions

- What do real `usage` numbers look like, and does `stop_reason` flip to `max_tokens` at
  the 1024 ceiling? *(blocked — needs an API key)*
- Time-to-first-token vs. total time: streaming should not change total latency, only
  when the user first sees something. *(blocked — needs a successful call)*
- What happens if the user navigates away mid-stream? `ReadableStream` has a `cancel`
  handler and `fetch` takes an `AbortSignal`; neither is wired up. *Deferred.*
- Switching to SSE for automatic reconnection. *Deferred.*
