// A token bucket, pure apart from the clock you hand it. No imports, no
// privileges — the expression.ts / vector.ts / agent.ts pattern, and here the
// injected clock is the point: a rate limiter tested by sleeping in real time
// is a test suite that takes minutes and still misses the edges.

export type Bucket = {
  /** Tokens available right now, at `updated`. */
  tokens: number;
  /** When `tokens` was last recomputed, in epoch milliseconds. */
  updated: number;
};

export type Limit = {
  /** Bucket size — the most that can ever be spent in one burst. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
};

export type Verdict =
  | { allowed: true; remaining: number; bucket: Bucket }
  | { allowed: false; remaining: number; retryAfterSeconds: number; bucket: Bucket };

export function newBucket(limit: Limit, now: number): Bucket {
  return { tokens: limit.capacity, updated: now };
}

/**
 * Spend `cost` tokens if they are available.
 *
 * A token bucket rather than a fixed window because a fixed window lets a
 * caller spend the whole allowance at 11:59:59 and the whole next allowance at
 * 12:00:00 — double the intended rate, at the worst possible moment. A bucket
 * refills continuously, so there is no boundary to exploit.
 *
 * `cost` is a parameter because the routes are not equally expensive: the agent
 * may make six paid requests per call, chat makes one, search makes none.
 */
export function consume(
  bucket: Bucket,
  limit: Limit,
  cost: number,
  now: number,
): Verdict {
  // Refill for elapsed time, capped at capacity. Clamped at zero so a clock
  // that jumps backwards cannot mint tokens.
  const elapsedSeconds = Math.max(0, now - bucket.updated) / 1000;
  const tokens = Math.min(
    limit.capacity,
    bucket.tokens + elapsedSeconds * limit.refillPerSecond,
  );

  if (tokens < cost) {
    const deficit = cost - tokens;
    return {
      allowed: false,
      remaining: Math.floor(tokens),
      retryAfterSeconds: Math.ceil(deficit / limit.refillPerSecond),
      bucket: { tokens, updated: now },
    };
  }

  const left = tokens - cost;
  return {
    allowed: true,
    remaining: Math.floor(left),
    bucket: { tokens: left, updated: now },
  };
}

/**
 * Drop buckets that have refilled to capacity and gone quiet.
 *
 * Without this the map is an unbounded, attacker-controlled allocation: one
 * entry per source address, and the addresses are chosen by whoever calls. A
 * rate limiter that can be made to exhaust memory has defeated its own purpose.
 */
export function evictIdle(
  buckets: Map<string, Bucket>,
  limit: Limit,
  now: number,
  idleMs = 10 * 60 * 1000,
): number {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    const full =
      bucket.tokens + (Math.max(0, now - bucket.updated) / 1000) * limit.refillPerSecond >=
      limit.capacity;
    if (full && now - bucket.updated > idleMs) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}
