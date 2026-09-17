// The spend time-range choices shared between GET /api/metrics and the
// /metrics page — one whitelist, so the two can never validate a `?window=`
// value differently. Pure, no imports — the ratelimit.ts / stats.ts pattern.
//
// Whitelisted rather than accepting an arbitrary ?window=<ms>: an unbounded
// value here is an unbounded SQL scan (usage.byRoute → breakdownByRoute),
// triggered by a query string a visitor controls.
export const SPEND_WINDOWS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} as const;

export type SpendWindow = keyof typeof SPEND_WINDOWS;

export function isSpendWindow(value: string | null | undefined): value is SpendWindow {
  return value !== null && value !== undefined && value in SPEND_WINDOWS;
}

/** The requested window if valid, the default otherwise — never throws on bad input. */
export function parseSpendWindow(value: string | null | undefined): SpendWindow {
  return isSpendWindow(value) ? value : "24h";
}
