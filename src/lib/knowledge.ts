import "server-only";

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { chunkMarkdown, chunkText, type Chunk } from "./chunk";
import { EMBEDDING_MODEL, embed } from "./embeddings";
import { embedCache, textHash } from "./embedcache";
import { topK, type Scored } from "./vector";
import { log } from "./log";
import { readyWithin, sharedRetryable } from "./once";
import { record } from "./telemetry";

export type Source = Chunk & { file: string };

// Measured problem: sections that are LISTS OF QUESTIONS embed close to any
// question-shaped query, so they out-ranked the sections holding the answers on
// nearly every query. They also contain no findings — by construction they are
// what the experiment did not know. Excluding them is corpus curation, not a
// hack: a passage that cannot answer anything should not be retrievable.
const SKIP_SECTIONS = new Set([
  "questions",
  "future questions",
  "objective",
  "questions i still don't understand",
]);

function isRetrievable(chunk: Chunk): boolean {
  const tail = chunk.heading.split(" > ").pop()?.trim().toLowerCase() ?? "";
  return !SKIP_SECTIONS.has(tail);
}

// The notebook is read from disk at startup rather than imported, so writing a
// new experiment README is all it takes to make it searchable. The trade is
// that these files must exist next to the running server.
function loadSources(): Source[] {
  const root = process.cwd();
  const files: { path: string; title: string }[] = [];

  const experiments = join(root, "experiments");
  if (existsSync(experiments)) {
    for (const dir of readdirSync(experiments).sort()) {
      const path = join(experiments, dir, "README.md");
      if (existsSync(path)) files.push({ path, title: dir });
    }
  }
  for (const name of ["ARCHITECTURE.md", "GLOSSARY.md"]) {
    const path = join(root, "docs", name);
    if (existsSync(path)) files.push({ path, title: name.replace(".md", "") });
  }

  return files.flatMap(({ path, title }) =>
    chunkMarkdown(readFileSync(path, "utf8"), title)
      .filter(isRetrievable)
      .map((chunk) => ({ ...chunk, file: path.slice(root.length + 1) })),
  );
}

// Read, chunk and embed once. As in Experiment 007 the PROMISE is cached, so
// two requests arriving together share a single index build.
// Retried after a failure (Experiment 026) — see once.ts.
const getIndex = sharedRetryable(async () => {
  const started = Date.now();
  const sources = loadSources();

  // Experiment 024. Embedding is deterministic, so a chunk whose text has not
  // changed does not need re-embedding. Before this, every restart re-embedded
  // the whole notebook — 256 chunks, 516.6 seconds, measured in 023.
  const { vectors, stats } = await embedCache.get(
    sources.map(chunkText),
    EMBEDDING_MODEL,
    embed,
  );

  // The build used to happen in silence while requests simply waited. It is
  // the slowest thing this process does; it should say so.
  log({
    level: "info",
    msg: "notebook index ready",
    chunks: sources.length,
    cache_hits: stats.hits,
    embedded: stats.misses,
    ms: Date.now() - started,
  });

  indexBuilt = true;
  return sources.map((item, i) => ({ item, vector: vectors[i] }));
});

let indexBuilt = false;

/**
 * Whether the index is ready, in the cross-layer sense `/metrics`'s status
 * badge actually needs answered. Not a safe gate for a route to 503 on — see
 * `ensureIndexReady()`, which still owns that.
 *
 * `indexBuilt` alone only answers "has THIS module instance finished
 * building" — and Next.js gives a Route Handler, a Server Component page and
 * `instrumentation.ts` separate instances of this module (Experiment
 * 033/034), each with its own copy of that flag starting false. A layer that
 * has not run its own build yet would report "Building" even while every
 * other layer — and the embedding cache itself — has been ready for hours.
 *
 * The fix is the same move Experiment 025 already made for `cached_vectors`
 * right next to this badge: read the SQLite-backed cache, which every layer
 * shares, instead of module-scoped state, which none of them do. A raw count
 * comparison would not be enough — `embeddings` has no purge (Experiment 024
 * never needed one), so an edited or removed experiment leaves orphaned rows
 * that could make a stale count look sufficient by accident. Checking that
 * every hash the CURRENT corpus actually needs is present avoids that: it is
 * exactly the query `getIndex()` itself would make to find out whether this
 * would be a 100% cache hit, minus the embedding call that only runs on a
 * miss.
 *
 * Cheap enough to run on every `/metrics` request: `loadSources()` is markdown
 * parsing over files already on disk, not the model call that made
 * Experiment 023's cold build take 516 seconds.
 */
export function indexReady(): boolean {
  if (indexBuilt) return true;

  const hashes = loadSources().map((source) => textHash(chunkText(source)));
  if (hashes.length === 0) return false;

  return embedCache.lookup(hashes, EMBEDDING_MODEL).size === hashes.length;
}

/**
 * Starts the index build without waiting for it.
 *
 * Experiment 023 measured a cold build at 516.6 seconds, during which every
 * request to /api/ask simply WAITED — the promise was cached, so the second
 * caller queued behind the first with no indication that anything was
 * happening. A silent eight-minute wait is indistinguishable from a hang.
 *
 * Used by `instrumentation.ts` to start the build at boot without blocking
 * the server from accepting requests. NOT used by routes to decide whether to
 * 503 — see `ensureIndexReady()`, which replaced that use in Experiment 034.
 */
export function warmIndex(): void {
  void getIndex().catch(() => {
    // Swallowed deliberately: this is fire-and-forget, and an unhandled
    // rejection here would take down the process. The awaiting caller in
    // retrieve() still sees the real error.
  });
}

// Experiment 034, `indexReady()` itself fixed in 038. Even now that
// `indexReady()` is cross-layer-correct, it is still only a snapshot: it
// looks at whether the needed hashes are cached RIGHT NOW and returns
// immediately either way — it does not start a build, and it does not wait
// for one already running. That is exactly right for an informational badge
// and exactly wrong for a route deciding whether to 503: a plain
// `if (!indexReady())` would still refuse a request that a few hundred
// milliseconds of waiting would have let through — the exact cost
// Experiment 025 was built to remove.
//
// The question a first request actually needs answered isn't "is it built
// RIGHT NOW" — it's "will it be built SOON ENOUGH to be worth waiting for".
// Since Experiment 024, `getIndex()` reads from `embedCache`, a real file
// every layer shares — so THIS layer's first build, even on a fresh
// `indexBuilt`, is a cache read (measured: 77-312ms), not the 516s cold-embed
// 024 fixed. Worth a bounded wait instead of an instant refusal.
const INDEX_WAIT_TIMEOUT_MS = 3000;

/**
 * Waits for the index, but not forever. Resolves `true` once ready, or
 * `false` if `timeoutMs` passes first — the build keeps running regardless
 * (it is the same memoized promise `getIndex()`/`retrieve()` use), so a
 * caller that gave up does not slow down or restart it for the next one.
 */
export async function ensureIndexReady(timeoutMs = INDEX_WAIT_TIMEOUT_MS): Promise<boolean> {
  return indexBuilt || readyWithin(getIndex(), timeoutMs);
}

// Experiment 035. `observe()` (observe.ts) times a whole route, but for a
// streaming one like /api/ask that is time-to-first-byte, not "how long did
// retrieval take" specifically — its own docstring flags this exact gap as
// deferred: "which layer owns the latency, not just the total".
//
// Reuses `telemetry.record()` rather than a new subsystem: it already groups
// by an arbitrary string label and computes p50/p95 per label, which is
// exactly what a sub-phase timing needs. "retrieval" is not an HTTP route —
// labelled that way deliberately, so it reads on /metrics as what it is
// (this function's own cost), not another endpoint.
//
// Unlike the rest of a model turn, this is fully measurable without the
// Anthropic credential: embedding and vector search are local.
export async function retrieve(query: string, k = 4): Promise<Scored<Source>[]> {
  const started = Date.now();
  try {
    const [index, [queryVector]] = await Promise.all([getIndex(), embed([query])]);
    const result = topK(queryVector, index, k);
    record({ route: "retrieval", status: 200, ms: Date.now() - started });
    return result;
  } catch (error) {
    record({ route: "retrieval", status: 500, ms: Date.now() - started });
    throw error;
  }
}

export async function indexSize(): Promise<number> {
  return (await getIndex()).length;
}
