// Pure vector maths. No imports, no privileges — the expression.ts pattern from
// Experiment 006, for the same reason: it makes the logic exhaustively testable
// and keeps the privileged surface small.

/**
 * Cosine similarity: the cosine of the angle between two vectors, ignoring
 * their lengths. Ranges from 1 (same direction) through 0 (unrelated) to
 * -1 (opposite).
 *
 * Length is ignored on purpose. A long document and a short query about the
 * same subject should match, and only their DIRECTION carries the meaning.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) {
    throw new Error("Cannot compare empty vectors");
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    throw new Error("Cannot compare a zero vector");
  }

  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

export type Scored<T> = { item: T; score: number };

/** The `k` items whose vectors are closest to `query`, best first. */
export function topK<T>(
  query: number[],
  items: { item: T; vector: number[] }[],
  k: number,
): Scored<T>[] {
  return items
    .map(({ item, vector }) => ({ item, score: cosineSimilarity(query, vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}
