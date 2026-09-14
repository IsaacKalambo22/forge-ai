import "server-only";

import { timingSafeEqual } from "node:crypto";

import { consume, evictIdle, newBucket, type Bucket, type Limit } from "./ratelimit";
import { SESSION_COOKIE, readCookie, verifySession } from "./session";

// Per-caller allowance. Capacity is the burst; refill is the sustained rate.
// 20 tokens refilling at 1/3 per second ≈ 20 chat calls per minute sustained.
const PER_CALLER: Limit = { capacity: 20, refillPerSecond: 1 / 3 };

// A global ceiling on paid work, shared by every caller. The per-caller limit
// bounds one abuser; this bounds the bill when there are many, or one with many
// addresses. Modelled as a bucket refilling over 24h, so there is no midnight
// boundary to game and no date arithmetic.
const DAILY_PAID_REQUESTS = 200;
const GLOBAL: Limit = {
  capacity: DAILY_PAID_REQUESTS,
  refillPerSecond: DAILY_PAID_REQUESTS / 86_400,
};

// What each route may cost, in paid upstream requests. The agent is the reason
// weighting exists: one call can be six.
export const COST = {
  search: 0, // local model only — rate-limited, but spends no money
  chat: 1,
  analyze: 1,
  ask: 1,
  agent: 6, // MAX_STEPS
} as const;

export type RouteName = keyof typeof COST;

// In-memory state. Honest limitation: it resets when the process restarts and
// is not shared between instances, so this bounds accidents and casual abuse,
// not a determined attacker across a scaled deployment. Redis is the real
// answer and is deferred.
const callers = new Map<string, Bucket>();
let globalBucket: Bucket | null = null;
let lastEviction = 0;

function callerKey(request: Request): string {
  // WARNING: x-forwarded-for is set by the client unless a trusted proxy
  // overwrites it. Behind Vercel or a properly configured reverse proxy it is
  // trustworthy; exposed directly it is a value the attacker chooses, and this
  // limiter is then per-attacker-whim rather than per-caller.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip && ip !== "" ? ip : "unknown";
}

/** Constant-time comparison, so timing cannot reveal the secret one byte at a time. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // keep the work roughly constant
    return false;
  }
  return timingSafeEqual(a, b);
}

function checkAuth(request: Request): Response | null {
  const expected = process.env.APP_SECRET;

  if (expected === undefined || expected === "") {
    // Fail CLOSED in production: an unset secret there is a misconfiguration,
    // not permission to serve a paid endpoint to the internet.
    if (process.env.NODE_ENV === "production") {
      console.error("APP_SECRET is not set; refusing to serve paid endpoints.");
      return Response.json(
        { error: "Server is not configured for public access" },
        { status: 503 },
      );
    }
    return null; // local development: open, as it always has been
  }

  // Two ways in, for two different kinds of caller.
  //
  //   Bearer token  — scripts and curl. The caller holds the secret.
  //   Session cookie — the browser. It holds a SIGNED CLAIM instead, because a
  //                    browser that held the secret would leak it (Exp. 001/002).
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer !== "" && secretMatches(bearer, expected)) return null;

  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (cookie !== null && verifySession(cookie, expected, Date.now()).valid) return null;

  // No distinction between missing, wrong, expired or forged — the difference
  // is information an attacker can use.
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/** True when a secret is configured, so the UI knows whether to show a login form. */
export function authRequired(): boolean {
  const secret = process.env.APP_SECRET;
  return secret !== undefined && secret !== "";
}

export function hasValidSession(request: Request): boolean {
  const secret = process.env.APP_SECRET;
  if (secret === undefined || secret === "") return true; // dev: open
  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return cookie !== null && verifySession(cookie, secret, Date.now()).valid;
}

/**
 * Returns a Response to send instead of doing the work, or null to proceed.
 *
 * Called BEFORE any streaming begins, so it can still use real status codes —
 * Experiment 004. A 429 emitted mid-stream would be an HTTP 200.
 */
export function guard(request: Request, route: RouteName): Response | null {
  const denied = checkAuth(request);
  if (denied !== null) return denied;

  return rateLimit(request, route);
}

/**
 * Rate limiting WITHOUT the auth check — for the login endpoint, which by
 * definition cannot require authentication. An unlimited login endpoint is an
 * offer to brute-force the secret, so it still needs a limit; it just cannot
 * get one from `guard`.
 */
export function rateLimit(request: Request, route: RouteName): Response | null {
  const now = Date.now();
  const cost = COST[route];

  // Amortised cleanup: the caller map is keyed by attacker-supplied values, so
  // it must not grow without bound.
  if (now - lastEviction > 60_000) {
    evictIdle(callers, PER_CALLER, now);
    lastEviction = now;
  }

  const key = callerKey(request);
  const caller = callers.get(key) ?? newBucket(PER_CALLER, now);
  // Every request costs at least 1 against the per-caller limit, so free routes
  // still cannot be hammered.
  const callerVerdict = consume(caller, PER_CALLER, Math.max(1, cost), now);
  callers.set(key, callerVerdict.bucket);

  if (!callerVerdict.allowed) {
    return limited(callerVerdict.retryAfterSeconds, "Rate limit exceeded", PER_CALLER.capacity, 0);
  }

  if (cost > 0) {
    globalBucket ??= newBucket(GLOBAL, now);
    const globalVerdict = consume(globalBucket, GLOBAL, cost, now);
    globalBucket = globalVerdict.bucket;

    if (!globalVerdict.allowed) {
      return limited(
        globalVerdict.retryAfterSeconds,
        "Daily budget exhausted",
        PER_CALLER.capacity,
        callerVerdict.remaining,
      );
    }
  }

  return null;
}

function limited(
  retryAfter: number,
  message: string,
  capacity: number,
  remaining: number,
): Response {
  return Response.json(
    { error: message, retry_after_seconds: retryAfter },
    {
      status: 429,
      headers: {
        // Standard hints so a client can back off intelligently instead of
        // retrying immediately and making things worse.
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": String(capacity),
        "RateLimit-Remaining": String(remaining),
      },
    },
  );
}
