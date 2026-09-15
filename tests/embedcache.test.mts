// Experiment 024. The embedder is INJECTED, so these run in milliseconds against
// a real SQLite database without loading a 23MB model. What can be wrong here is
// the caching logic, and that is independent of whatever produced the numbers.
import { openDatabase } from "@/lib/db";
import {
  textHash, vectorToBlob, blobToVector, lookup, store, countCached, embedCached,
} from "@/lib/embedcache";
import { group, ok, eq, near } from "./harness.mts";

const T = 1_700_000_000_000;
const MODEL = "test-model";
const DIMS = 384;
const fresh = () => openDatabase(":memory:");

/** A deterministic stand-in for the model, which counts how often it is called. */
function fakeEmbedder() {
  let calls = 0;
  let textsSeen = 0;
  const fn = async (texts: string[]) => {
    calls++;
    textsSeen += texts.length;
    return texts.map((t) =>
      Array.from({ length: DIMS }, (_, i) => ((t.charCodeAt(i % t.length) + i) % 100) / 100),
    );
  };
  return { fn, get calls() { return calls; }, get textsSeen() { return textsSeen; } };
}

group("embedcache — hashing identifies TEXT, not position");
eq("same text, same hash", textHash("hello"), textHash("hello"));
ok("different text, different hash", textHash("hello") !== textHash("hellp"));
ok("hash is a sha-256 hex digest", /^[0-9a-f]{64}$/.test(textHash("x")));
// The property that makes the cache worth having: moving a section between
// files, or down a document, must not invalidate it.
eq("a chunk that moved is still the same chunk",
  textHash("## Setup\nRun the server."), textHash("## Setup\nRun the server."));

group("embedcache — vectors round-trip exactly through the BLOB");
const vector = Array.from({ length: DIMS }, (_, i) => (i - 192) / 384);
const round = blobToVector(vectorToBlob(vector));
eq("same length", round.length, DIMS);
// float32, so exact equality is not expected — but the error must be tiny.
let worst = 0;
for (let i = 0; i < DIMS; i++) worst = Math.max(worst, Math.abs(round[i] - vector[i]));
ok("every component survives to float32 precision", worst < 1e-6, `worst delta ${worst.toExponential(2)}`);
near("a negative component", blobToVector(vectorToBlob([-0.5]))[0], -0.5, 1e-7);
near("zero", blobToVector(vectorToBlob([0]))[0], 0, 1e-9);

group("embedcache — store and look up");
const d = fresh();
eq("empty to start", countCached(d, MODEL), 0);
eq("storing returns the count", store(d, [{ hash: "a", vector }, { hash: "b", vector }], MODEL, T), 2);
eq("counted", countCached(d, MODEL), 2);
const got = lookup(d, ["a", "b", "missing"], MODEL);
eq("found two", got.size, 2);
ok("a miss is simply absent", !got.has("missing"));
eq("storing the same hash twice does not duplicate",
  (() => { store(d, [{ hash: "a", vector }], MODEL, T); return countCached(d, MODEL); })(), 2);

group("embedcache — vectors are keyed by MODEL as well as text");
// Vectors from different models are not comparable; mixing them produces
// meaningless similarities rather than an error, which is worse.
store(d, [{ hash: "a", vector }], "another-model", T);
eq("both models hold the same hash", countCached(d, MODEL) + countCached(d, "another-model"), 3);
eq("a lookup only sees its own model", lookup(d, ["a"], "another-model").size, 1);
eq("and does not leak across", lookup(d, ["b"], "another-model").size, 0);

group("embedcache — THE POINT: the second build embeds nothing");
const c = fresh();
const texts = ["alpha", "beta", "gamma", "delta"];
const first = fakeEmbedder();
const one = await embedCached(c, texts, MODEL, first.fn, T);
eq("first build embeds everything", one.stats.misses, 4);
eq("nothing was cached", one.stats.hits, 0);
eq("the model was called", first.calls, 1);

const second = fakeEmbedder();
const two = await embedCached(c, texts, MODEL, second.fn, T);
eq("second build embeds nothing", two.stats.misses, 0);
eq("everything came from cache", two.stats.hits, 4);
eq("the model was NOT called at all", second.calls, 0);

group("embedcache — the vectors are identical either way");
let maxDelta = 0;
for (let i = 0; i < texts.length; i++) {
  for (let j = 0; j < DIMS; j++) {
    maxDelta = Math.max(maxDelta, Math.abs(one.vectors[i][j] - two.vectors[i][j]));
  }
}
ok("cached vectors match freshly computed ones", maxDelta < 1e-6,
  `worst delta ${maxDelta.toExponential(2)}`);

group("embedcache — editing one chunk costs ONE embedding, not all of them");
// The reason the cache is keyed by text hash rather than by file.
const edited = ["alpha", "beta CHANGED", "gamma", "delta"];
const third = fakeEmbedder();
const three = await embedCached(c, edited, MODEL, third.fn, T);
eq("three hits", three.stats.hits, 3);
eq("one miss", three.stats.misses, 1);
eq("only the changed text reached the model", third.textsSeen, 1);

group("embedcache — order changes cost nothing");
const reordered = ["delta", "alpha", "gamma", "beta CHANGED"];
const fourth = fakeEmbedder();
const four = await embedCached(c, reordered, MODEL, fourth.fn, T);
eq("all hits", four.stats.hits, 4);
eq("the model was not called", fourth.calls, 0);
// And the vectors must follow the NEW order, not the cached order.
let delta0 = 0;
for (let j = 0; j < DIMS; j++) {
  delta0 = Math.max(delta0, Math.abs(four.vectors[0][j] - three.vectors[3][j]));
}
ok("vectors are returned in the caller's order", delta0 < 1e-6);

group("embedcache — a repeated text is embedded once");
const dupes = ["same", "same", "same"];
const fifth = fakeEmbedder();
const five = await embedCached(fresh(), dupes, MODEL, fifth.fn, T);
eq("only one text reached the model", fifth.textsSeen, 1);
eq("but three vectors come back", five.vectors.length, 3);

group("embedcache — an embedder that returns the wrong count is an error");
// Silently zipping a short result against the hashes would pair vectors with
// the wrong texts — retrieval would then be confidently wrong, which is far
// worse than a crash.
let mismatch: string | null = null;
try {
  await embedCached(fresh(), ["a", "b"], MODEL, async () => [[1]], T);
} catch (error) {
  mismatch = (error as Error).message;
}
ok("it throws rather than mispairing vectors", mismatch !== null, mismatch ?? "did not throw");
ok("and says what it expected", (mismatch ?? "").includes("Expected 2 vectors, got 1"), mismatch ?? "");

group("embedcache — survives a restart");
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-embed-${Math.random().toString(36).slice(2)}.db`;
const before = openDatabase(path);
const warm = fakeEmbedder();
await embedCached(before, texts, MODEL, warm.fn, T);
before.close();

const after = openDatabase(path);
const cold = fakeEmbedder();
const restarted = await embedCached(after, texts, MODEL, cold.fn, T);
eq("nothing re-embedded after a restart", restarted.stats.misses, 0);
eq("the model was never loaded", cold.calls, 0);
eq("all four served from disk", restarted.stats.hits, 4);
after.close();
