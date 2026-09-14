import { consume, evictIdle, newBucket, type Bucket, type Limit } from "@/lib/ratelimit";
import { group, ok } from "./harness.mts";

const limit: Limit = { capacity: 10, refillPerSecond: 1 };
const T = 1_000_000;

group("ratelimit — spending");
ok("a new bucket starts full", newBucket(limit, T).tokens === 10);
let v = consume(newBucket(limit, T), limit, 1, T);
ok("spend 1 of 10 → allowed, 9 left", v.allowed && v.remaining === 9);
v = consume(v.bucket, limit, 9, T);
ok("spend the remaining 9 → allowed, 0 left", v.allowed && v.remaining === 0);
v = consume(v.bucket, limit, 1, T);
ok("spend 1 more → denied", !v.allowed);
ok("denied reports retry-after", !v.allowed && v.retryAfterSeconds === 1,
  !v.allowed ? `${v.retryAfterSeconds}s` : "");

group("ratelimit — refill");
let drained = consume(newBucket(limit, T), limit, 10, T);
ok("4s later, 5 requested → denied", !consume(drained.bucket, limit, 5, T + 4_000).allowed);
ok("4s later, 4 requested → allowed", consume(drained.bucket, limit, 4, T + 4_000).allowed);
ok("10s later → fully refilled", consume(drained.bucket, limit, 10, T + 10_000).allowed);
const hour = consume(drained.bucket, limit, 1, T + 3_600_000);
ok("1h later → capped at capacity, not 3600", hour.allowed && hour.remaining === 9,
  hour.allowed ? `${hour.remaining} left` : "");

group("ratelimit — weighted cost");
v = consume(newBucket(limit, T), limit, 6, T);
ok("an agent call costing 6 leaves 4", v.allowed && v.remaining === 4);
const second = consume(v.bucket, limit, 6, T);
ok("a second agent call is denied", !second.allowed);
ok("retry-after scales with the deficit", !second.allowed && second.retryAfterSeconds === 2,
  !second.allowed ? `${second.retryAfterSeconds}s` : "");

group("ratelimit — edges and defences");
const free = consume(newBucket(limit, T), limit, 0, T);
ok("zero cost is allowed and free", free.allowed && free.remaining === 10);
ok("cost above capacity is never satisfiable", !consume(newBucket(limit, T), limit, 11, T).allowed);
const input: Bucket = { tokens: 3, updated: T };
const back = consume(input, limit, 1, T - 60_000);
ok("a backwards clock cannot mint tokens", back.allowed && back.remaining === 2,
  back.allowed ? `${back.remaining} left` : "");
ok("the input bucket is not mutated", input.tokens === 3);

group("ratelimit — eviction (unbounded-map defence)");
const map = new Map<string, Bucket>([
  ["idle-full", { tokens: 10, updated: T }],
  ["idle-empty", { tokens: 0, updated: T }],
  ["recent", { tokens: 10, updated: T + 10 * 60 * 1000 }],
]);
const removed = evictIdle(map, limit, T + 11 * 60 * 1000);
ok("an idle full bucket is evicted", !map.has("idle-full"));
ok("an idle bucket that refilled is also evicted", !map.has("idle-empty"));
ok("a recently used bucket is kept", map.has("recent"));
ok("the count removed is returned", removed === 2, `${removed}`);
const busy = new Map<string, Bucket>([["x", { tokens: 2, updated: T }]]);
ok("a bucket still in debt is never evicted", evictIdle(busy, limit, T + 5_000) === 0 && busy.has("x"));
