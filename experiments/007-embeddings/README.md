# Experiment 007 — Embeddings

## Objective

Search by meaning instead of by keyword, and understand what a vector actually is.

## Questions

1. Where do embeddings come from?
2. What is an embedding, concretely?
3. How do you compare two of them?
4. Does semantic search actually work, or does it just sound good?

## Implementation

### Finding: Anthropic has no embeddings API

Checked rather than assumed — the client's resources are:

```text
completions, messages, models, files, skills, beta
```

No `embeddings`. Anthropic does not offer one; embeddings come from a separate provider
(Voyage AI is the recommended partner). This is the first time the project has needed
something outside the Anthropic SDK.

A **local model** was chosen over a hosted one: `all-MiniLM-L6-v2` running in the Node
process via transformers.js. No API key, no second account, no per-call cost — and,
importantly for this project, it is the first experiment whose results could actually be
*observed* rather than recorded as blocked.

### Finding: the current runtime does not support this machine

The obvious install (`@huggingface/transformers@4.2.0`) fails at **import** time:

```text
MODULE_NOT_FOUND
  onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node
```

Diagnosis, in order:

| Check | Result |
| --- | --- |
| `pnpm` ran the native build? | no — install scripts blocked by default |
| after allowing `onnxruntime-node` to build | same error |
| what the loader wants | `bin/napi-v6/${platform}/${arch}/…` |
| what ships in 1.24.3 | `darwin/arm64` only — **no `darwin/x64`** |
| this machine | `x86_64`, Intel Core i5-5257U, not Rosetta |

onnxruntime 1.24.3 has dropped Intel macOS. `device: "wasm"` does not help, because the
failure happens when the module is **imported**, before any pipeline options are read.

Resolved by pinning `@xenova/transformers@2.17.2`, whose `onnxruntime-node@1.14.0` does
ship `darwin/x64`. Verified working: model loads in 13.1 s, produces 384 numbers.

Two general lessons, neither about embeddings:

- `pnpm` blocks postinstall scripts by default. Native packages need
  `pnpm.onlyBuiltDependencies` in `package.json` — a silent, confusing failure otherwise.
- "Works on my machine" runs both ways. A dependency can be perfectly correct and still
  have no binary for your CPU.

### What an embedding actually is

```text
"hello world"  →  [-0.0357, 0.0207, 0.0047, 0.0265, -0.0503, … ]   384 numbers
                  magnitude 1.000000
```

384 floats, normalised to length 1. Position encodes meaning: texts about similar things
land in similar directions. `normalize: true` is what makes scores comparable across
texts of different lengths.

Comparison is **cosine similarity** — the cosine of the angle between two vectors,
ignoring their lengths. Length is discarded on purpose: a long document and a short query
about the same subject should match, and only direction carries the meaning.

### Verified: 12/12 vector maths

`src/lib/vector.ts` is pure, with no imports — the `expression.ts` pattern from
Experiment 006, for the same testability reason.

```text
cosineSimilarity: identical=1 · opposite=-1 · orthogonal=0
                  length-invariant (×100)=1 · 45°=0.707107 · negatives=1
Rejects:          dimension mismatch · empty vectors · zero vector
topK:             ordering east,ne,north · k limits results · k > length returns all

12 passed, 0 failed
```

The length-invariance case is the one that matters: `[1,2,3]` and `[100,200,300]` score
exactly 1.0.

## Observations

### Verified: semantic search works — with zero shared keywords

Against five sentences taken from this project's own documentation:

| Query | Top hit | Shared keywords |
| --- | --- | --- |
| "how do I stop my credentials leaking to the client" | the API-key lesson (0.268) | **none** |
| "why does a long chat get more expensive" | the quadratic-cost lesson (0.468) | **none** |
| "can I return an error code once the response started" | the status-line lesson (0.348) | **none** |
| "is it safe to run code the model generated" | the never-eval lesson (0.258) | **none** |

4 / 4 correct, and **not one query shared a single word longer than three characters with
the document it matched.** Keyword search would have returned nothing for any of them.
That is the entire case for embeddings, demonstrated rather than asserted.

### Finding: a bigger corpus made the top result worse

The real corpus is 16 lessons from Experiments 001–006, not 5. Scored against it:

| Query | Expected top-1 | Actual top-1 | top-1 | in top-3 |
| --- | --- | --- | --- | --- |
| credentials leaking to the client | `001-key-in-browser` | `002-select-never-supply` | ✗ | ✓ (3rd) |
| why does a long chat get more expensive | `003-quadratic-cost` | `003-quadratic-cost` | ✓ | ✓ |
| error code once the response started | `004-status-first-byte` | `004-status-first-byte` | ✓ | ✓ |
| safe to run model-generated code | `006-never-eval` | `006-never-eval` | ✓ | ✓ |
| model keeps calling tools forever, bill is huge | `006-cap-the-loop` | `006-tool-args-untrusted` | ✗ | ✓ (3rd) |
| system prompt ended up in the browser bundle | `002-module-trust` | `001-key-in-browser` | ✗ | ✓ (3rd) |
| resend the whole conversation every time | `003-stateless` | `003-stateless` | ✓ | ✓ |

**4/7 top-1. 7/7 top-3.**

The first query scored 4/4 in the five-document test and fails here. Adding more
*related* documents made it worse, which is worth sitting with: the query says "client",
and two lessons contain the literal word "client" in a different sense — the HTTP client,
not the browser. Embeddings reduce keyword-matching problems; they do not abolish them,
and an overloaded word still pulls.

Two practical consequences:

1. **Retrieve top-k, not top-1.** Every expected answer appeared in the top 3. A system
   that takes only the best match would be wrong 43% of the time here; one that passes
   three candidates to a model that can choose would not. This is exactly why RAG feeds
   several chunks to the model rather than one.
2. **Scores are relative, not confidence.** A correct top hit scores 0.451 in one query
   and 0.235 in another. There is no threshold that means "good match" — only the ranking
   within one query is meaningful. The UI shows the raw score for that reason.

### Verified: embedding the corpus once, not per search

| | time |
| --- | --- |
| first search (model load + 16 lessons embedded) | **766 ms** |
| every search after | **5–6 ms** |

A ~130× difference. The corpus never changes at runtime, so both the model and the index
are cached behind a promise — the *promise* is cached, not the result, so two requests
arriving together cannot both start a load. Re-embedding the corpus on every search is
the obvious mistake and would have cost 760 ms per query forever.

### Verified: routes and bundle

| Check | Result |
| --- | --- |
| `{"query":""}` · `{}` · `{"query":42}` · malformed JSON · 501 chars | 400 each |
| `onnxruntime`, `xenova`, `cosineSimilarity`, `lib/embeddings`, corpus text, `x-api-key` in browser | **0 hits each** |
| bundle | 14 chunks, 3,770,962 bytes (+15,708 = the search UI) |

The corpus is imported into a Client Component for its *type* only, so none of the lesson
text shipped. The Experiment 003 result holds a third time.

## Lessons

1. **Embedding** — a fixed-length list of numbers (here 384) positioned so that texts with
   similar meaning point in similar directions.
2. **Cosine similarity** — the cosine of the angle between two vectors, ignoring length.
   1 is identical direction, 0 unrelated, -1 opposite.
3. Length is deliberately discarded so a long document and a short query can match.
4. Anthropic provides no embeddings API. Embeddings come from elsewhere — a hosted
   provider, or a local model.
5. Semantic search genuinely works: 4/4 correct matches with **zero shared keywords**.
6. It is not magic. On a larger corpus, top-1 accuracy was 4/7 — overloaded words still
   pull the wrong way.
7. **Retrieve top-k, not top-1.** 7/7 correct answers were in the top 3. Give a model
   candidates, not a verdict.
8. Similarity scores are rankings, not confidence. No threshold generalises across
   queries.
9. Embed the corpus once and cache it; cache the *promise* so concurrent requests share
   one load. 766 ms → 6 ms.
10. `pnpm` blocks native postinstall scripts by default; `pnpm.onlyBuiltDependencies` is
    the switch.
11. A package can be correct and still ship no binary for your CPU. Check
    `process.platform`/`process.arch` against what is actually in the package.
12. Pure maths belongs in a module with no imports. Twelve tests, no server needed.

## Future questions

- **Chunking.** These lessons were hand-written to be one idea each. Real documents must
  be split, and where you cut changes what can be found. *Experiment 008.*
- **A vector database.** 16 lessons compared in a loop takes 6 ms. At 100,000 the linear
  scan stops being viable and an index is needed. Not before. *Deferred.*
- Would a larger embedding model fix the 4/7? Worth measuring before assuming.
- Nothing here is evaluated automatically. The table above was assembled by hand, which
  does not scale — retrieval evaluation is its own problem. *Deferred.*
- The search endpoint runs a model with no rate limit. Cheap per call, not free, and
  unauthenticated. *Deferred to a security/limits experiment.*
