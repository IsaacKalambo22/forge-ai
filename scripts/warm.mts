// Experiment 025 — `pnpm warm`. Builds the embedding cache, then exits.
//
// For the places where paying 196.8 seconds inside a request is the wrong
// answer: CI, a fresh clone, or a deploy that wants to be ready before traffic
// arrives. Idempotent — run it twice and the second is ~70ms.
import { indexSize } from "@/lib/knowledge";
import { embedCache, EMBED_CACHE_PATH } from "@/lib/embedcache";
import { EMBEDDING_MODEL } from "@/lib/embeddings";

const before = embedCache.count(EMBEDDING_MODEL);
console.log(`\nforge-ai — warming the notebook index`);
console.log(`  cache: ${EMBED_CACHE_PATH}  (${before} vectors)\n`);

const started = Date.now();
const chunks = await indexSize();
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const after = embedCache.count(EMBEDDING_MODEL);

console.log(`\n  ${chunks} chunks indexed in ${seconds}s`);
console.log(`  ${after - before} newly embedded, ${after} cached in total\n`);
