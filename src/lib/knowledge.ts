import "server-only";

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { chunkMarkdown, chunkText, type Chunk } from "./chunk";
import { EMBEDDING_MODEL, embed } from "./embeddings";
import { embedCache } from "./embedcache";
import { topK, type Scored } from "./vector";
import { log } from "./log";

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
let indexPromise: Promise<{ item: Source; vector: number[] }[]> | null = null;

function getIndex() {
  indexPromise ??= (async () => {
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
  })();
  return indexPromise;
}

let indexBuilt = false;

/** True once the index is built. Lets a route answer honestly while it warms. */
export function indexReady(): boolean {
  return indexBuilt;
}

/**
 * Starts the index build without waiting for it.
 *
 * Experiment 023 measured a cold build at 516.6 seconds, during which every
 * request to /api/ask simply WAITED — the promise was cached, so the second
 * caller queued behind the first with no indication that anything was
 * happening. A silent eight-minute wait is indistinguishable from a hang.
 *
 * A route can now kick the build off and return 503 + Retry-After instead,
 * which is the truthful answer: not broken, not ready.
 */
export function warmIndex(): void {
  void getIndex().catch(() => {
    // Swallowed deliberately: this is fire-and-forget, and an unhandled
    // rejection here would take down the process. The awaiting caller in
    // retrieve() still sees the real error.
  });
}

export async function retrieve(query: string, k = 4): Promise<Scored<Source>[]> {
  const [index, [queryVector]] = await Promise.all([getIndex(), embed([query])]);
  return topK(queryVector, index, k);
}

export async function indexSize(): Promise<number> {
  return (await getIndex()).length;
}
