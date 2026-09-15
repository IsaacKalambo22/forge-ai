import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";
import { EMBEDDING_DIMENSIONS } from "./embeddings";

// Experiment 024. Embedding is deterministic: the same text through the same
// model always produces the same vector. So it is cacheable, and Experiment 023
// measured what not caching it costs — 516.6 seconds on every restart.
//
// The cache is keyed by a hash of the text. NOT by file path or chunk index: a
// section that moves to another document, or shifts down as text is inserted
// above it, is the same text and must not be re-embedded. Editing one paragraph
// should cost one embedding, not the whole notebook.

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Vectors are stored as a BLOB of little-endian float32.
 *
 * JSON would be roughly 8x larger and would round-trip through decimal strings,
 * which is both slower and lossy in the last bits. A Float32Array is exactly
 * what the model produced.
 */
export function vectorToBlob(vector: number[]): Uint8Array {
  const floats = Float32Array.from(vector);
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
}

export function blobToVector(blob: Uint8Array): number[] {
  // The stored bytes may not be 4-byte aligned once SQLite hands them back, so
  // copy into a fresh buffer rather than viewing them in place. Reading a
  // misaligned Float32Array throws.
  const copy = new Uint8Array(blob);
  return Array.from(new Float32Array(copy.buffer, 0, copy.byteLength / 4));
}

export type CacheStats = { hits: number; misses: number; stored: number };

/** Every cached vector for these hashes, as a map. Missing keys are cache misses. */
export function lookup(
  database: DatabaseSync,
  hashes: string[],
  model: string,
): Map<string, number[]> {
  const found = new Map<string, number[]>();
  if (hashes.length === 0) return found;

  // Chunked IN clauses: SQLite has a host-parameter limit (commonly 999), and a
  // 256-chunk notebook would be fine while a larger one silently would not.
  const BATCH = 400;
  for (let i = 0; i < hashes.length; i += BATCH) {
    const slice = hashes.slice(i, i + BATCH);
    const placeholders = slice.map(() => "?").join(",");
    const rows = database
      .prepare(
        `SELECT hash, vector, dims FROM embeddings
          WHERE model = ? AND hash IN (${placeholders})`,
      )
      .all(model, ...slice) as { hash: string; vector: Uint8Array; dims: number }[];

    for (const row of rows) {
      // A row whose dimensionality does not match the current model is from a
      // different world. Ignore it rather than returning a vector that will
      // produce a dimension-mismatch throw deep inside cosineSimilarity.
      if (row.dims !== EMBEDDING_DIMENSIONS) continue;
      found.set(row.hash, blobToVector(row.vector));
    }
  }
  return found;
}

export function store(
  database: DatabaseSync,
  entries: { hash: string; vector: number[] }[],
  model: string,
  now: number,
): number {
  if (entries.length === 0) return 0;

  const insert = database.prepare(
    `INSERT INTO embeddings (hash, model, dims, vector, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash, model) DO NOTHING`,
  );

  // One transaction: 256 individual commits is 256 fsyncs, and the whole point
  // of this experiment is that the slow path should only ever run once.
  database.exec("BEGIN");
  try {
    for (const { hash, vector } of entries) {
      insert.run(hash, model, vector.length, vectorToBlob(vector), now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return entries.length;
}

export function countCached(database: DatabaseSync, model: string): number {
  return (
    database.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE model = ?").get(model) as
      { n: number }
  ).n;
}

/**
 * Embeds `texts`, reading whatever is already cached and storing what is not.
 *
 * `embedMissing` is injected rather than imported so this is testable without
 * loading a 23MB model — the caching logic is what can be wrong here, and it is
 * entirely independent of what produced the numbers.
 */
export async function embedCached(
  database: DatabaseSync,
  texts: string[],
  model: string,
  embedMissing: (texts: string[]) => Promise<number[][]>,
  now: number,
): Promise<{ vectors: number[][]; stats: CacheStats }> {
  const hashes = texts.map(textHash);
  const cached = lookup(database, hashes, model);

  // Deduplicate: the same text appearing twice should be embedded once.
  const missing = [...new Set(hashes.filter((h) => !cached.has(h)))];
  const missingTexts = missing.map((hash) => texts[hashes.indexOf(hash)]);

  const fresh = missingTexts.length > 0 ? await embedMissing(missingTexts) : [];
  if (fresh.length !== missingTexts.length) {
    throw new Error(`Expected ${missingTexts.length} vectors, got ${fresh.length}`);
  }

  const toStore = missing.map((hash, i) => ({ hash, vector: fresh[i] }));
  const stored = store(database, toStore, model, now);
  for (const { hash, vector } of toStore) cached.set(hash, vector);

  return {
    vectors: hashes.map((hash) => cached.get(hash)!),
    stats: { hits: hashes.length - missing.length, misses: missing.length, stored },
  };
}

// ---------------------------------------------------------------------------

export const embedCache = {
  get: (texts: string[], model: string, embedMissing: (t: string[]) => Promise<number[][]>) =>
    embedCached(db(), texts, model, embedMissing, Date.now()),
  count: (model: string) => countCached(db(), model),
};
