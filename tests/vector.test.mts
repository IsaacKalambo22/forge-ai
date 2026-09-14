import { cosineSimilarity, topK } from "@/lib/vector";
import { eq, group, near, ok, throws } from "./harness.mts";

group("vector — cosine similarity");
near("identical direction", cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
near("opposite direction", cosineSimilarity([1, 0, 0], [-1, 0, 0]), -1);
near("orthogonal", cosineSimilarity([1, 0], [0, 1]), 0);
near("length-invariant (×100)", cosineSimilarity([1, 2, 3], [100, 200, 300]), 1);
near("45 degrees", cosineSimilarity([1, 0], [1, 1]), Math.SQRT1_2);
near("negative components", cosineSimilarity([-1, -2], [-2, -4]), 1);

group("vector — rejects");
throws("dimension mismatch", () => cosineSimilarity([1, 2], [1, 2, 3]));
throws("empty vectors", () => cosineSimilarity([], []));
throws("zero vector", () => cosineSimilarity([0, 0], [1, 1]));

group("vector — topK");
const items = [
  { item: "east", vector: [1, 0] },
  { item: "north", vector: [0, 1] },
  { item: "west", vector: [-1, 0] },
  { item: "ne", vector: [1, 1] },
];
eq("ordering by similarity", topK([1, 0], items, 3).map((r) => r.item), ["east", "ne", "north"]);
ok("k limits the result", topK([1, 0], items, 2).length === 2);
ok("k larger than input returns all", topK([1, 0], items, 99).length === 4);
