// Runs a real embedding model in this Node process — no API, no key, no
// network after the first download. See experiments/007-embeddings for why a
// local model was chosen over a hosted one.
import "server-only";

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// 384 dimensions. Small and fast; not the strongest model available, which is
// the trade for running on a laptop CPU.
const MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// Loading the model takes seconds and allocates real memory, so it is loaded
// once and reused. The promise itself is cached, not the result — otherwise
// two requests arriving together would both start a load.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  // `pipeline()` is typed as a union of every pipeline kind, so the task name
  // has to be narrowed by hand.
  extractorPromise ??= pipeline("feature-extraction", MODEL) as Promise<FeatureExtractionPipeline>;
  return extractorPromise;
}

/**
 * Embed one or more texts. `normalize: true` scales every vector to length 1,
 * which makes cosine similarity equal to a plain dot product and keeps scores
 * comparable across texts of different sizes.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });

  // The result is one flat Float32Array for all inputs; slice it per text.
  const flat = Array.from(output.data as Float32Array);
  return texts.map((_, i) =>
    flat.slice(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS),
  );
}
