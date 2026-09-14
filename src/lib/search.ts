import "server-only";

import { LESSONS, type Lesson } from "./corpus";
import { embed } from "./embeddings";
import { topK, type Scored } from "./vector";

// Embedding the corpus takes real work, and the corpus never changes at
// runtime, so it is embedded once on first use and reused. Re-embedding on
// every search would be the obvious mistake.
let indexPromise: Promise<{ item: Lesson; vector: number[] }[]> | null = null;

function getIndex() {
  indexPromise ??= embed(LESSONS.map((lesson) => lesson.text)).then((vectors) =>
    LESSONS.map((lesson, i) => ({ item: lesson, vector: vectors[i] })),
  );
  return indexPromise;
}

export async function searchLessons(query: string, k = 3): Promise<Scored<Lesson>[]> {
  const [index, [queryVector]] = await Promise.all([getIndex(), embed([query])]);
  return topK(queryVector, index, k);
}
