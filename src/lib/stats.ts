// Latency statistics. No imports, no privileges — same pattern as metrics.ts.
//
// Why percentiles and not an average: an average hides the tail, and the tail
// is the user experience. Nine fast requests and one 10-second request average
// out to something that looks fine while one in ten users waits ten seconds.
// p95 is the number that notices.

/**
 * Nearest-rank percentile. `p` is 0–100.
 *
 * Nearest-rank rather than interpolating: every value it returns is a real
 * measurement that actually occurred, which matters when you are about to go
 * looking for the request that produced it.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("Cannot take a percentile of no samples");
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new Error(`Percentile must be between 0 and 100, got ${p}`);
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)];
}

export type Summary = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export function summarize(values: number[]): Summary {
  if (values.length === 0) throw new Error("Cannot summarize no samples");
  return {
    count: values.length,
    min: percentile(values, 0),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: percentile(values, 100),
  };
}
