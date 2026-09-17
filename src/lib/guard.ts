import "server-only";

import { timingSafeEqual } from "node:crypto";

import { consume, evictIdle, newBucket, type Bucket, type Limit } from "./ratelimit";
import { SESSION_COOKIE, readCookie, verifySession } from "./session";
import { revocations } from "./revocation";
import { users, DEV_USER_ID } from "./users";
import { usage } from "./usage";
import { reservations } from "./reservation";
import { dollars, formatCost, PRICING, DEFAULT_MODEL, MAX_OUTPUT_TOKENS } from "./pricing";

// Per-caller allowance. Capacity is the burst; refill is the sustained rate.
// 20 tokens refilling at 1/3 per second ≈ 20 chat calls per minute sustained.
const PER_CALLER: Limit = { capacity: 20, refillPerSecond: 1 / 3 };

// A global ceiling on paid work, shared by every caller. The per-caller limit
// bounds one abuser; this bounds the bill when there are many, or one with many
// addresses. Modelled as a bucket refilling over 24h, so there is no midnight
// boundary to game and no date arithmetic.
//
// Experiment 017 kept this and stopped relying on it as the spending control.
// Counting requests bounds the RATE of paid work; it does not bound the BILL,
// because a request is not a fixed amount of money — one agent call is six
// upstream calls, and a 20-turn conversation resends its whole history.
const DAILY_PAID_REQUESTS = 200;
const GLOBAL: Limit = {
  capacity: DAILY_PAID_REQUESTS,
  refillPerSecond: DAILY_PAID_REQUESTS / 86_400,
};

// The real spending controls, in money, read from the Experiment 017 ledger.
// Overridable so an operator can set them without editing code.
function budget(name: string, fallbackUsd: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return dollars(Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackUsd);
}

const DAILY_TOTAL_BUDGET = () => budget("FORGE_DAILY_BUDGET_USD", 5);
const DAILY_USER_BUDGET = () => budget("FORGE_USER_DAILY_BUDGET_USD", 1);

// What each route may cost, in paid upstream requests. The agent is the reason
// weighting exists: one call can be six.
export const COST = {
  search: 0, // local model only — rate-limited, but spends no money
  login: 0,   // no model call; rate-limited because it guards a password
  logout: 0,
  register: 0,
  metrics: 0, // reads in-process counters — but still auth'd and rate-limited
  conversations: 0, // reads the transcript store — no model call
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

// Experiment 029. `guard()` calls `checkAuth()` before `rateLimit()`, so on
// every route it protects an identity already exists by the time the limiter
// runs — it was simply never asked for. `login`/`register` call `rateLimit()`
// directly, before any session exists, and stay IP-keyed on purpose: a
// password-guessing attempt has no user id to be limited BY, only one to
// guess. `userId` is undefined only on that pre-auth path.
function callerKey(request: Request, userId?: string): string {
  if (userId !== undefined) return `user:${userId}`;

  // WARNING: x-forwarded-for is set by the client unless a trusted proxy
  // overwrites it. Behind Vercel or a properly configured reverse proxy it is
  // trustworthy; exposed directly it is a value the attacker chooses, and this
  // limiter is then per-attacker-whim rather than per-caller.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip && ip !== "" ? `ip:${ip}` : "ip:unknown";
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

/**
 * WHO is making this request. Experiment 016.
 *
 * Before 016 authentication answered only "does the caller know the password",
 * and there was nothing to answer WITH. Now every allowed request carries an
 * identity, because a route that cannot name the caller cannot check whether
 * a conversation is theirs.
 */
export type Identity = { userId: string };

function checkAuth(request: Request): Response | Identity {
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
    // Local development: open, as it always has been — but as a REAL user
    // rather than as nobody, because an unowned request cannot own anything.
    return { userId: users.ensureDev() };
  }

  // Two ways in, for two different kinds of caller.
  //
  //   Bearer token  — scripts and curl. The caller holds APP_SECRET, which
  //                   since 016 is an operator credential: it acts as the
  //                   local-dev user rather than as a person, because it names
  //                   no one. It is the key that signs sessions, not an
  //                   identity that has them.
  //   Session cookie — the browser. It holds a SIGNED CLAIM instead, because a
  //                    browser that held the secret would leak it (Exp. 001/002),
  //                    and since 016 that claim says WHO.
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer !== "" && secretMatches(bearer, expected)) {
    return { userId: users.ensureDev() };
  }

  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (cookie !== null) {
    const result = verifySession(cookie, expected, Date.now());
    // Experiment 015. The signature says the token is AUTHENTIC; it cannot say
    // whether it has been logged out, because signing is stateless and a logout
    // is a fact about the world after the token was issued. The denylist is the
    // only thing that knows.
    if (result.valid && !revocations.isRevoked(cookie)) {
      // The subject is trusted ONLY because the MAC verified first. A payload
      // read before the signature check is attacker-authored data.
      return { userId: result.payload.sub };
    }
  }

  // No distinction between missing, wrong, expired, forged or revoked — the
  // difference is information an attacker can use.
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
  if (cookie === null) return false;
  if (!verifySession(cookie, secret, Date.now()).valid) return false;
  return !revocations.isRevoked(cookie);
}

/** The signed-in user, or null. Used by pages, which do not go through guard. */
export function currentUserId(request: Request): string | null {
  const secret = process.env.APP_SECRET;
  if (secret === undefined || secret === "") return DEV_USER_ID;
  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (cookie === null) return null;
  const result = verifySession(cookie, secret, Date.now());
  if (!result.valid || revocations.isRevoked(cookie)) return null;
  return result.payload.sub;
}

/**
 * Returns a Response to send instead of doing the work, or null to proceed.
 *
 * Called BEFORE any streaming begins, so it can still use real status codes —
 * Experiment 004. A 429 emitted mid-stream would be an HTTP 200.
 *
 * `requestId` — Experiment 014's correlation id, already minted by `observe()`
 * before this runs — is what a paid route's reservation is keyed on, so the
 * same id that ties a log line to a response also ties a budget claim to the
 * request that must eventually release it.
 */
export function guard(request: Request, route: RouteName, requestId: string): Response | Identity {
  const auth = checkAuth(request);
  if (auth instanceof Response) return auth;

  const limited = rateLimit(request, route, auth.userId);
  if (limited !== null) return limited;

  const broke = checkBudget(auth.userId, route, requestId);
  if (broke !== null) return broke;

  return auth;
}

// Experiment 037. How long a reservation counts against the budget before it
// is treated as abandoned. Generous relative to any single upstream call
// (MAX_OUTPUT_TOKENS bounds one call's generation time, not this), because the
// slowest real route is `agent` running up to COST.agent sequential calls —
// and short enough that a request that errors out before reaching its
// route's `finally` (an early validation failure, a crash) self-heals inside
// minutes rather than holding budget hostage for the rest of the day.
const RESERVATION_TTL_MS = 5 * 60_000;

/**
 * What a request to `route` could still cost before anything about it is
 * known — the number `checkBudget` had no way to get at before this
 * reservation existed.
 *
 * OUTPUT tokens only, not input: `MAX_OUTPUT_TOKENS` is a real ceiling every
 * call site in ai.ts is bound by (Experiment 001's Q7), so output cost has a
 * true worst case before the call is ever made. Input cost does not — it
 * depends on retrieved passages and conversation history this function
 * cannot see without re-deriving what ai.ts is about to send — so it is left
 * to the exact figure `usage.record()` writes once the real response comes
 * back, same as before. This still closes the failure mode that mattered:
 * concurrent requests that would otherwise all read the same "spent so far"
 * and all proceed now each stake a real, non-zero claim against it first.
 *
 * `COST[route]` doubles as the upstream-call count, same as `rateLimit()`
 * already uses it — including its one known imprecision: `chat`'s tool loop
 * can take up to `MAX_TOOL_ITERATIONS` turns but is weighted as 1, same gap
 * the rate limiter has always had. Not widened here, not fixed here either.
 */
function reservedCostFor(route: RouteName): number {
  return COST[route] * MAX_OUTPUT_TOKENS * PRICING[DEFAULT_MODEL].output;
}

/**
 * Experiment 017, closed by Experiment 037.
 *
 * 017's honest limitation: this authorizes a request on spending SO FAR, and
 * the cost of the request being authorized was unknowable until it finished —
 * "a ceiling with a lip, not a hard cap." Two requests arriving together both
 * saw the same spent-so-far figure and both proceeded, because neither had
 * billed anything yet.
 *
 * The fix: count outstanding reservations — this request's about to be, and
 * every other in-flight request's already-staked claim — alongside recorded
 * spend, and stake this one before returning. A concurrent second request now
 * sees the first's claim even though the first has not billed a token yet.
 */
function checkBudget(userId: string, route: RouteName, requestId: string): Response | null {
  if (COST[route] === 0) return null; // free routes spend nothing

  const reservedCost = reservedCostFor(route);

  const spentTotal = usage.spentTotal() + reservations.activeTotal();
  if (spentTotal + reservedCost > DAILY_TOTAL_BUDGET()) {
    console.error(
      `Daily budget exhausted: ${formatCost(spentTotal)} of ${formatCost(DAILY_TOTAL_BUDGET())}` +
        ` (this request would reserve ${formatCost(reservedCost)})`,
    );
    return Response.json(
      { error: "Daily budget exhausted" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const spentByUser = usage.spentByUser(userId) + reservations.activeByUser(userId);
  if (spentByUser + reservedCost > DAILY_USER_BUDGET()) {
    return Response.json(
      { error: "Your daily budget is exhausted" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  reservations.reserve({ requestId, userId, route, amountNanodollars: reservedCost }, RESERVATION_TTL_MS);
  return null;
}

/**
 * For the metrics endpoint — what is left, in nanodollars.
 *
 * Experiment 037 made the ENFORCEMENT check (`checkBudget`, above) count
 * outstanding reservations; this display was left reporting recorded spend
 * only, a deliberately separate decision. Experiment 038 closes that gap:
 * `reserved` is its own field, kept apart from `spent_today` because the two
 * mean different things — one is permanent billing history, the other is a
 * claim that is usually gone within seconds — and `remaining` now subtracts
 * both, so the number an operator reads as "what can still be spent" agrees
 * with the number `checkBudget` actually authorizes against.
 */
export function budgetStatus() {
  const total = DAILY_TOTAL_BUDGET();
  const spent = usage.spentTotal();
  const reserved = reservations.activeTotal();
  return {
    daily_budget: formatCost(total),
    spent_today: formatCost(spent),
    reserved: formatCost(reserved),
    remaining: formatCost(Math.max(0, total - spent - reserved)),
    per_user_budget: formatCost(DAILY_USER_BUDGET()),
  };
}

/**
 * Rate limiting WITHOUT the auth check — for the login endpoint, which by
 * definition cannot require authentication. An unlimited login endpoint is an
 * offer to brute-force the secret, so it still needs a limit; it just cannot
 * get one from `guard`.
 */
export function rateLimit(request: Request, route: RouteName, userId?: string): Response | null {
  const now = Date.now();
  const cost = COST[route];

  // Amortised cleanup: the caller map is keyed by attacker-supplied values
  // (IP) or by our own ids (userId), so it must not grow without bound either
  // way. Piggybacks the reservations table's own cleanup onto the same timer
  // rather than inventing a second one — every guarded request already passes
  // through here, so nothing extra needs to call in for either to stay bounded.
  if (now - lastEviction > 60_000) {
    evictIdle(callers, PER_CALLER, now);
    reservations.purge();
    lastEviction = now;
  }

  const key = callerKey(request, userId);
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
