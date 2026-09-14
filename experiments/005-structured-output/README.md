# Experiment 005 — Structured Output

## Objective

Make the model return a typed object that other code can consume, instead of prose a
human has to read.

## Questions

1. How do you constrain the model's output to a shape?
2. What does the model actually receive — does it see the schema?
3. What happens when the output does not match?
4. Does adding a schema library leak into the browser?

## Implementation

Feature: **auto-generated conversation titles and topics** — the thing Claude.ai does in
its sidebar. A real use for structured output: `analysis.title` has to be a *field*, not
a sentence somewhere inside a paragraph.

```text
src/lib/analysis.ts        zod schema + inferred type   — client-safe
src/lib/ai.ts              analyzeConversation()        — server-only
src/app/api/analyze/route.ts   POST /api/analyze
```

`messages.parse()` with `output_config: { format: zodOutputFormat(Schema) }` replaces
`messages.create()`. The model is constrained to the schema, and the SDK validates the
response and returns `parsed_output` as a typed object.

`zod` was added as a direct dependency. It was already present, but only as a **peer
dependency of the Anthropic SDK satisfied by an eslint plugin's copy** — a devDependency
change could have removed it out from under production code. Depending on something you
did not declare is depending on an accident.

## Observations

### Verified: `.describe()` is sent to the model

Dumping what `zodOutputFormat()` actually produces — this is the JSON that goes on the
wire:

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "A short title for this conversation, 2 to 5 words, no punctuation"
      },
      "topics": { "type": "array", "description": "Up to 4 technical topics discussed, each 1-3 words", "items": {"$ref": "#/$defs/__schema0"} },
      "open_questions": { "type": "array", "description": "Questions the user asked that were not fully answered", "items": {"$ref": "#/$defs/__schema1"} }
    },
    "additionalProperties": false,
    "required": ["title", "topics", "open_questions"]
  }
}
```

Three things this makes concrete:

1. **`.describe()` is not documentation for humans.** The text is serialised into the
   schema and sent to the model, so each description is a per-field instruction. "2 to 5
   words, no punctuation" is a prompt.
2. **`additionalProperties: false` and `required: [every field]` were added
   automatically.** Nobody wrote them. That is what makes the schema *strict*: no extra
   keys, no optional fields. A zod `.optional()` would change this.
3. The `$defs` / `$ref` indirection for array items is a conversion artifact, harmless.

**Oddity, observed but not explained:** the generated object also carries
`"description": "{$schema: \"https://json-schema.org/draft/2020-12/schema\"}"` at the top
level — the JSON Schema dialect marker apparently leaking into a `description` string
during zod-to-JSON-Schema conversion. Whether the model is affected by a stray
description is **untested**. Noted so it is not mistaken for something intentional.

### Verified: route behaviour

| Request | Response |
| --- | --- |
| valid 3-turn conversation | **502** `Analysis failed: 401 … invalid x-api-key` |
| `{"messages":[]}` | 400 `messages must be a non-empty array` |
| `role: "system"` | 400 `role of user\|assistant` |
| malformed JSON | 400 `Invalid JSON body` |
| `GET /api/analyze` | 405 — no `GET` exported |

The **502** is worth contrasting with Experiment 004. `/api/chat` returns the identical
401 as an HTTP **200** with an error object inside the stream; `/api/analyze` returns a
real **502**, because it does not stream and has not yet sent a byte. Same failure, two
different shapes, decided purely by whether the response has started.

### `parsed_output` can be null — handle it, don't assert it

The SDK returns `parsed_output: null` when the response fails schema validation. The
documented example writes `response.parsed_output!.name` with a non-null assertion; this
route checks instead:

```ts
if (response.parsed_output === null) {
  return Response.json({ error: "Model output did not match the schema" }, { status: 502 });
}
```

Constrained decoding makes a mismatch unlikely, not impossible. `!` silences the compiler
about a case the SDK deliberately models — the type is nullable because reality is.

### Verified: zod did not reach the browser — and a grep hit proved nothing

`analysis.ts` imports zod as a **value**; `chat.tsx` imports from `analysis.ts`. That is
the exact shape of the Experiment 002 leak, with a new library. So: check.

Grepping the browser chunks for `ZodObject` returned **1 hit** — which looked like a leak.
It was not:

| Check | Result |
| --- | --- |
| `ZodObject` in Experiment **004** bundle (before zod was installed) | **1 — already there** |
| Chunk carrying it | `next_dist_compiled_next-devtools_index_…` |
| `node_modules/zod` | 0 |
| `lib/analysis.ts` | 0 |
| The `.describe()` strings | 0 |
| Byte growth 004 → 005 | 11,861 bytes |

The zod in the bundle is **Next.js's own devtools copy**, present before this experiment
began, in a dev-only chunk. Mine never shipped: `chat.tsx` uses `import type` for
`ConversationAnalysis`, which is erased at compile time, so the schema *value* and its
descriptions stayed on the server. 11.8 KB of growth is the analysis UI, not a library.

**The lesson is the investigation, not the result.** A grep hit is evidence, not a verdict.
Three questions turned it from alarming to settled: was it there *before*? which chunk is
it *in*? are *my* identifiers next to it? Without the Experiment 004 bundle to compare
against, this would have been a confident, wrong conclusion.

### Not verified

**Whether the model returns schema-conforming output.** That is the central claim of this
experiment, and it cannot be checked without a successful call — every request still ends
at 401. What is verified is everything up to the network: the schema is correct, the
descriptions are in it, the route validates, the null case is handled, the bundle is
clean. What the model does with it is unobserved.

## Lessons

1. **Structured output** — constraining the model to a schema via `output_config.format`
   so the result is a typed object rather than prose.
2. This is the boundary between output a *person* reads and output *code* consumes.
   Regex-parsing prose is the trap a schema exists to avoid.
3. `.describe()` text is sent to the model. Field descriptions are prompts; write them as
   instructions.
4. `zodOutputFormat()` adds `additionalProperties: false` and marks every field required.
   Strictness is the default here, and `.optional()` is what relaxes it.
5. `parsed_output` is nullable because validation can fail. Handle the null; do not `!`
   it away.
6. A non-streaming route keeps real status codes for model failures. The same 401 is a
   502 here and an HTTP 200 in `/api/chat` — the difference is whether bytes have been
   sent (Experiment 004).
7. A transitive or peer dependency is not a dependency. Declare what you import.
8. `import type` kept a value-importing module off the client again — the Experiment 003
   result holds with a heavier library.
9. **A grep hit is not proof.** Check whether it predates your change, which chunk owns
   it, and whether your own identifiers are near it. Keeping earlier bundles made this
   answerable in one command.

## Future questions

- Does the model actually honour "2 to 5 words"? Descriptions are instructions, not
  constraints — the schema enforces *type*, not *content*. *(blocked — needs an API key)*
- What does the stray top-level `description` artifact do, if anything? *Deferred.*
- Analysis re-reads the whole transcript on every click and is not cached, so clicking
  twice costs twice. *Deferred to a cost experiment.*
- **Strict tool use** (`strict: true` on a tool definition) is the same guarantee applied
  to tool arguments rather than the final response. That is Experiment 006.
