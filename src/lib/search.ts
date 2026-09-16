import "server-only";

import { LESSONS, type Lesson } from "./corpus";
import { embed } from "./embeddings";
import { topK, type Scored } from "./vector";
import { sharedRetryable } from "./once";

// Embedding the corpus takes real work, and the corpus never changes at
// runtime, so it is embedded once on first use and reused. Re-embedding on
// every search would be the obvious mistake.
//
// Retried after a failure (Experiment 026) — see once.ts for why `??=` was not
// enough.
const getIndex = sharedRetryable(() =>
  embed(LESSONS.map((lesson) => lesson.text)).then((vectors) =>
    LESSONS.map((lesson, i) => ({ item: lesson, vector: vectors[i] })),
  ),
);

export async function searchLessons(query: string, k = 3): Promise<Scored<Lesson>[]> {
  const [index, [queryVector]] = await Promise.all([getIndex(), embed([query])]);
  return topK(queryVector, index, k);
}
