import "server-only";

import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";

// The fix for the limitation guard.ts has stated plainly since Experiment 017:
//
//   "This authorizes a request on spending SO FAR, and the cost of the
//    request being authorized is unknowable until it finishes. So the budget
//    can always be exceeded by the cost of one in-flight request (or of
//    several arriving together). It is a ceiling with a lip, not a hard cap."
//
// A RESERVATION is a conservative claim staked BEFORE the model is called, so
// two requests that arrive together no longer both see an empty ledger and
// both proceed. `checkBudget()` counts outstanding reservations alongside
// recorded spend; the route releases its claim once the real cost is known,
// which is why this table's traffic is entirely temporary — nothing here is
// billing history, that stays in `usage`.
//
// Short-lived on purpose. A request that never reaches its release point
// (crashed process, a bug in some future route) must not hold budget hostage
// indefinitely, so every reservation carries its own expiry and an expired
// one is simply not counted — the same denylist-with-a-TTL shape
// `revocation.ts` uses for a stolen session.

export type Reservation = {
  requestId: string;
  userId: string;
  route: string;
  amountNanodollars: number;
};

/**
 * Stakes a claim for `amountNanodollars`, expiring at `now + ttlMs`.
 *
 * Idempotent on `request_id`, like `usage`'s own insert: a caller that somehow
 * reserved twice for the same request does not double-count against the
 * budget.
 */
export function reserve(
  database: DatabaseSync,
  reservation: Reservation,
  now: number,
  ttlMs: number,
): void {
  database
    .prepare(
      `INSERT INTO reservations
         (request_id, user_id, route, amount_nanodollars, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO NOTHING`,
    )
    .run(
      reservation.requestId,
      reservation.userId,
      reservation.route,
      reservation.amountNanodollars,
      now,
      now + ttlMs,
    );
}

/**
 * Releases a claim once the request that made it is done — successfully,
 * with an error, whichever comes first. Releasing a claim that was never made
 * (already expired, or never reserved) is a no-op, not an error: a route
 * calls this unconditionally in its `finally`, and it must not matter which
 * path got it there.
 */
export function release(database: DatabaseSync, requestId: string): void {
  database.prepare("DELETE FROM reservations WHERE request_id = ?").run(requestId);
}

/** Total nanodollars currently staked by everyone, excluding expired claims. */
export function activeTotal(database: DatabaseSync, now: number): number {
  const row = database
    .prepare(
      "SELECT COALESCE(SUM(amount_nanodollars), 0) AS total FROM reservations WHERE expires_at > ?",
    )
    .get(now) as { total: number };
  return row.total;
}

/** Total nanodollars currently staked by one user, excluding expired claims. */
export function activeByUser(database: DatabaseSync, userId: string, now: number): number {
  const row = database
    .prepare(
      "SELECT COALESCE(SUM(amount_nanodollars), 0) AS total FROM reservations " +
        "WHERE user_id = ? AND expires_at > ?",
    )
    .get(userId, now) as { total: number };
  return row.total;
}

/**
 * Drops rows whose reservations have expired.
 *
 * Not an optimisation — without it this table is an unbounded record of every
 * claim ever staked, most of them released within seconds of being written.
 * See `revocation.ts`'s `purgeExpired` for the same shape.
 */
export function purgeExpired(database: DatabaseSync, now: number): number {
  const before = countActive(database);
  database.prepare("DELETE FROM reservations WHERE expires_at <= ?").run(now);
  return before - countActive(database);
}

export function countActive(database: DatabaseSync): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM reservations").get() as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Process-wide wrappers.
// ---------------------------------------------------------------------------

export const reservations = {
  reserve: (reservation: Reservation, ttlMs: number) => reserve(db(), reservation, Date.now(), ttlMs),
  release: (requestId: string) => release(db(), requestId),
  activeTotal: () => activeTotal(db(), Date.now()),
  activeByUser: (userId: string) => activeByUser(db(), userId, Date.now()),
  purge: () => purgeExpired(db(), Date.now()),
};
