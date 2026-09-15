// Retrieval metrics. No imports, no privileges — the expression.ts / vector.ts
// pattern again, and for the same reason: a number you cannot verify by hand is
// not a measurement, it is a rumour. Every function here is checkable on paper.
//
// Vocabulary, because these names are used loosely everywhere:
//
//   relevant   the ids a human labelled as correct answers for a query
//   retrieved  the ids the system actually returned, IN RANK ORDER
//
// The order matters for MRR and not for recall. That difference is the whole
// reason both metrics exist.

/** Throws unless `retrieved` is a usable ranking. Duplicates mean an index bug. */
function assertRanking(retrieved: string[]): void {
  if (new Set(retrieved).size !== retrieved.length) {
    throw new Error("Ranking contains duplicate ids");
  }
}

function assertK(k: number, retrieved: string[]): void {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be a positive integer, got ${k}`);
  }
  if (k > retrieved.length) {
    throw new Error(`k=${k} exceeds the ${retrieved.length} ids retrieved`);
  }
}

function assertRelevant(relevant: string[]): void {
  if (relevant.length === 0) {
    throw new Error("A query with no relevant ids cannot be scored");
  }
}

/**
 * recall@k — of the answers that exist, what fraction did we surface in the
 * top k?  Answers "did we FIND it".
 *
 * Denominator is the number of relevant ids, so it is unaffected by k. Raising
 * k can only ever raise recall, which is why recall alone is never enough:
 * returning the entire corpus scores 1.0.
 */
export function recallAtK(relevant: string[], retrieved: string[], k: number): number {
  assertRelevant(relevant);
  assertRanking(retrieved);
  assertK(k, retrieved);

  // Deduplicate the labels: two labels naming the same id must not let recall
  // exceed 1.0.
  const wanted = new Set(relevant);
  const top = new Set(retrieved.slice(0, k));
  const hits = [...wanted].filter((id) => top.has(id)).length;
  return hits / wanted.size;
}

/**
 * precision@k — of the k things we returned, what fraction were correct?
 * Answers "did we surface JUNK".
 *
 * The counterweight to recall. Returning the whole corpus makes recall 1.0 and
 * precision approximately zero, which is how the two together catch what either
 * alone would miss.
 */
export function precisionAtK(relevant: string[], retrieved: string[], k: number): number {
  assertRelevant(relevant);
  assertRanking(retrieved);
  assertK(k, retrieved);

  const relevantSet = new Set(relevant);
  const hits = retrieved.slice(0, k).filter((id) => relevantSet.has(id)).length;
  return hits / k;
}

/**
 * Reciprocal rank — 1 / (position of the first correct answer), 1-indexed.
 * Zero when nothing relevant was retrieved at all.
 *
 * First at rank 1 scores 1.0; rank 2 scores 0.5; rank 4 scores 0.25. The steep
 * drop is deliberate: for a RAG prompt, a correct passage buried at rank 8 is
 * nearly as useless as one that is absent, because it may be cut by the k the
 * application actually sends to the model.
 */
export function reciprocalRank(relevant: string[], retrieved: string[]): number {
  assertRelevant(relevant);
  assertRanking(retrieved);

  const relevantSet = new Set(relevant);
  const index = retrieved.findIndex((id) => relevantSet.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) throw new Error("Cannot average an empty list");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
