// Runs a real embedding model in this Node process — no API, no key, no
// network after the first download. See experiments/007-embeddings for why a
// local model was chosen over a hosted one.
import "server-only";

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// 384 dimensions. Small and fast; not the strongest model available, which is
// the trade for running on a laptop CPU.
const MODEL = "Xenova/all-MiniLM-L6-v2";
/** Exported so cached vectors can be keyed by the model that produced them. */
export const EMBEDDING_MODEL = MODEL;
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
/**
 * How many texts go through the model at once.
 *
 * Experiment 024. This used to be "all of them" — one call with every chunk in
 * the notebook. At 256 chunks that peaked around 850 MB, because the batch is
 * padded to its LONGEST member: one 2000-token passage makes every other text
 * in the call that size. Batching bounds the peak and costs nothing in quality;
 * each text is embedded independently either way.
 */
const BATCH_SIZE = 16;

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const output = await extractor(batch, { pooling: "mean", normalize: true });

    // The result is one flat Float32Array for the batch; slice it per text.
    const flat = output.data as Float32Array;
    for (let i = 0; i < batch.length; i++) {
      vectors.push(
        Array.from(flat.subarray(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS)),
      );
    }
  }

  return vectors;
}
