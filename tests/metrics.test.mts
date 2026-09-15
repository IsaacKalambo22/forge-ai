// Experiment 013. Every expected value here is computed by hand in the label,
// because a metric you cannot check on paper will happily report that a broken
// retriever is excellent.
import { recallAtK, precisionAtK, reciprocalRank, mean } from "@/lib/metrics";
import { group, ok, near, throws } from "./harness.mts";

// A fixed ranking used throughout: two of the five are relevant, at ranks 2 and 4.
const RELEVANT = ["b", "d"];
const RANKING = ["a", "b", "c", "d", "e"];

group("metrics — recall@k");
near("k=1 finds neither of 2", recallAtK(RELEVANT, RANKING, 1), 0);
near("k=2 finds b only → 1/2", recallAtK(RELEVANT, RANKING, 2), 0.5);
near("k=3 still only b → 1/2", recallAtK(RELEVANT, RANKING, 3), 0.5);
near("k=4 finds b and d → 2/2", recallAtK(RELEVANT, RANKING, 4), 1);
near("k=5 cannot exceed 1.0", recallAtK(RELEVANT, RANKING, 5), 1);
near("single relevant at rank 1", recallAtK(["a"], RANKING, 1), 1);
near("duplicate labels do not inflate past 1.0", recallAtK(["b", "b"], RANKING, 2), 1);

group("metrics — recall is monotonic in k");
// The defining property: more results can never lose a hit you already had.
const curve = [1, 2, 3, 4, 5].map((k) => recallAtK(RELEVANT, RANKING, k));
ok("never decreases as k grows", curve.every((v, i) => i === 0 || v >= curve[i - 1]), curve.join(" → "));

group("metrics — precision@k");
near("k=1: 0 of 1 correct", precisionAtK(RELEVANT, RANKING, 1), 0);
near("k=2: 1 of 2 correct → 0.5", precisionAtK(RELEVANT, RANKING, 2), 0.5);
near("k=4: 2 of 4 correct → 0.5", precisionAtK(RELEVANT, RANKING, 4), 0.5);
near("k=5: 2 of 5 correct → 0.4", precisionAtK(RELEVANT, RANKING, 5), 0.4);
// The counterweight to recall, demonstrated rather than asserted.
near("returning everything: recall 1.0 …", recallAtK(RELEVANT, RANKING, 5), 1);
near("… but precision only 0.4", precisionAtK(RELEVANT, RANKING, 5), 0.4);

group("metrics — reciprocal rank");
near("first hit at rank 2 → 1/2", reciprocalRank(RELEVANT, RANKING), 0.5);
near("first hit at rank 1 → 1", reciprocalRank(["a"], RANKING), 1);
near("first hit at rank 4 → 1/4", reciprocalRank(["d"], RANKING), 0.25);
near("nothing relevant retrieved → 0", reciprocalRank(["zz"], RANKING), 0);
// Order is what separates MRR from recall. Same hits, different ranks.
near("recall ignores order", recallAtK(["a", "e"], ["a", "x", "y", "z", "e"], 5), 1);
near("…and so does the reversed case", recallAtK(["a", "e"], ["e", "x", "y", "z", "a"], 5), 1);
ok("but MRR does not",
  reciprocalRank(["e"], ["a", "x", "y", "z", "e"]) !== reciprocalRank(["e"], ["e", "x", "y", "z", "a"]),
  `${reciprocalRank(["e"], ["a", "x", "y", "z", "e"])} vs ${reciprocalRank(["e"], ["e", "x", "y", "z", "a"])}`);

group("metrics — rejects bad input");
throws("k of zero", () => recallAtK(RELEVANT, RANKING, 0));
throws("negative k", () => recallAtK(RELEVANT, RANKING, -1));
throws("fractional k", () => recallAtK(RELEVANT, RANKING, 1.5));
throws("k beyond what was retrieved", () => recallAtK(RELEVANT, RANKING, 99));
throws("no relevant ids is an unscoreable query", () => recallAtK([], RANKING, 1));
throws("duplicate ids in the ranking are an index bug", () => recallAtK(RELEVANT, ["a", "a"], 2));
throws("precision rejects the same", () => precisionAtK([], RANKING, 1));
throws("reciprocal rank rejects the same", () => reciprocalRank([], RANKING));

group("metrics — mean");
near("averages", mean([1, 0.5, 0]), 0.5);
near("single value", mean([0.25]), 0.25);
throws("empty list has no mean", () => mean([]));
