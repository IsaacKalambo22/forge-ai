// In-process request telemetry. Follows the ratelimit.ts shape: the mechanism
// is pure functions over an explicit value, and the mutable instance is a
// separate, clearly-marked holder at the bottom. That split is what made the
// rate limiter testable in Experiment 012, and it works for the same reason
// here.
import { summarize, type Summary } from "./stats";

export type Entry = {
  route: string;
  status: number;
  ms: number;
};

/**
 * A fixed-size ring buffer of recent requests.
 *
 * Bounded on purpose. An unbounded array of every request is a memory leak with
 * a slow fuse — it looks fine in development and exhausts the process in
 * production, which is a self-inflicted outage caused by the code meant to
 * detect outages.
 */
export type Buffer = {
  entries: Entry[];
  capacity: number;
  /** Total ever recorded, including entries since overwritten. */
  total: number;
};

export function newBuffer(capacity = 500): Buffer {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`Capacity must be a positive integer, got ${capacity}`);
  }
  return { entries: [], capacity, total: 0 };
}

/** Returns a new buffer with `entry` appended, oldest dropped past capacity. */
export function push(buffer: Buffer, entry: Entry): Buffer {
  const entries = [...buffer.entries, entry];
  return {
    ...buffer,
    entries: entries.length > buffer.capacity ? entries.slice(-buffer.capacity) : entries,
    total: buffer.total + 1,
  };
}

export type RouteStats = {
  count: number;
  /** Count by HTTP status, so a spike of 400s is distinguishable from 500s. */
  byStatus: Record<string, number>;
  errorRate: number;
  latency: Summary;
};

export type Snapshot = {
  /** Requests ever seen, including those aged out of the window. */
  total: number;
  /** Requests still in the window these statistics describe. */
  window: number;
  routes: Record<string, RouteStats>;
};

export function snapshot(buffer: Buffer): Snapshot {
  const routes: Record<string, RouteStats> = {};

  for (const route of new Set(buffer.entries.map((e) => e.route))) {
    const forRoute = buffer.entries.filter((e) => e.route === route);
    const byStatus: Record<string, number> = {};
    for (const entry of forRoute) {
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    }
    // 5xx only. A 400 means the CLIENT sent something invalid and the server
    // behaved correctly; counting it as an error makes the health metric move
    // when someone else's script is broken.
    const failures = forRoute.filter((e) => e.status >= 500).length;

    routes[route] = {
      count: forRoute.length,
      byStatus,
      errorRate: failures / forRoute.length,
      latency: summarize(forRoute.map((e) => e.ms)),
    };
  }

  return { total: buffer.total, window: buffer.entries.length, routes };
}

// ---------------------------------------------------------------------------
// The mutable instance. Everything above is pure and tested; this is the part
// that is neither.
//
// Honest limitation, same as the rate limiter's: this lives in one process. It
// resets on restart and is not shared between instances, so it is a development
// and single-instance tool. Real observability ships lines to a collector and
// aggregates there. Deferred until there is more than one process.
// ---------------------------------------------------------------------------

let current = newBuffer();

export function record(entry: Entry): void {
  current = push(current, entry);
}

export function currentSnapshot(): Snapshot {
  return snapshot(current);
}

/** Test affordance — the module-level buffer would otherwise leak across tests. */
export function resetTelemetry(): void {
  current = newBuffer();
}
