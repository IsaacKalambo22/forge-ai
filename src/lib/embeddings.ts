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
const BATCH_SIZE = (() => {
  // Overridable so the batched and unbatched paths can be measured back to back
  // under the same conditions. Experiment 025 needed that: 024's speedup claim
  // compared two numbers taken minutes apart on a loaded machine, which is not
  // an A/B test. `0` means "one call with everything", the original behaviour.
  const raw = Number(process.env.FORGE_EMBED_BATCH);
  if (Number.isInteger(raw) && raw >= 0) return raw;
  return 16;
})();

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const vectors: number[][] = [];

  const step = BATCH_SIZE === 0 ? texts.length : BATCH_SIZE;

  for (let start = 0; start < texts.length; start += step) {
    const batch = texts.slice(start, start + step);
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
