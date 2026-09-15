// Experiment 014. Hand-computable throughout: ten values 1..10 make every
// nearest-rank answer checkable without trusting the implementation.
import { percentile, summarize } from "@/lib/stats";
import { group, ok, eq, near, throws } from "./harness.mts";

const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

group("stats — percentile (nearest rank)");
near("p0 → smallest", percentile(TEN, 0), 1);
near("p50 → ceil(.50*10)=5 → 5th value", percentile(TEN, 50), 5);
near("p90 → ceil(.90*10)=9 → 9th value", percentile(TEN, 90), 9);
near("p95 → ceil(.95*10)=10 → 10th value", percentile(TEN, 95), 10);
near("p100 → largest", percentile(TEN, 100), 10);
near("single sample is every percentile", percentile([42], 95), 42);

group("stats — percentile does not care about input order");
near("shuffled gives the same p50", percentile([9, 3, 7, 1, 5], 50), 5);
ok("the caller's array is not mutated", (() => {
  const input = [3, 1, 2];
  percentile(input, 50);
  return JSON.stringify(input) === "[3,1,2]";
})());

group("stats — the tail is why percentiles exist");
// Nine fast requests and one slow one. The mean says 1091ms and implies
// everything is slowish; the percentiles say almost everything is 100ms and
// one request in ten is a disaster. Only the second is actionable.
const SKEWED = [100, 100, 100, 100, 100, 100, 100, 100, 100, 10_000];
const meanMs = SKEWED.reduce((a, b) => a + b, 0) / SKEWED.length;
near("the mean is misleading", meanMs, 1090);
near("p50 shows the typical request", percentile(SKEWED, 50), 100);
near("p95 finds the outlier the mean hid", percentile(SKEWED, 95), 10_000);

group("stats — summarize");
eq("full summary of 1..10", summarize(TEN), {
  count: 10, min: 1, p50: 5, p95: 10, p99: 10, max: 10,
});

group("stats — rejects");
throws("no samples has no percentile", () => percentile([], 50));
throws("no samples has no summary", () => summarize([]));
throws("percentile above 100", () => percentile(TEN, 101));
throws("negative percentile", () => percentile(TEN, -1));
throws("NaN percentile", () => percentile(TEN, NaN));
