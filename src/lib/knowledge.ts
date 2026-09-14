import "server-only";

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { chunkMarkdown, chunkText, type Chunk } from "./chunk";
import { embed } from "./embeddings";
import { topK, type Scored } from "./vector";

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
    const sources = loadSources();
    const vectors = await embed(sources.map(chunkText));
    return sources.map((item, i) => ({ item, vector: vectors[i] }));
  })();
  return indexPromise;
}

export async function retrieve(query: string, k = 4): Promise<Scored<Source>[]> {
  const [index, [queryVector]] = await Promise.all([getIndex(), embed([query])]);
  return topK(queryVector, index, k);
}

export async function indexSize(): Promise<number> {
  return (await getIndex()).length;
}
